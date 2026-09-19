import { describe, expect, it } from "vitest";
import {
  confirmedSeparations,
  separationResolutionWeeks,
  acknowledgeByAgent,
  canAutoReplay,
  evaluateWeeklyResult,
  replayEmployeeKpiHistory,
  runWeeklyHistory,
  noLongerMeasured,
  shouldAgeOut,
  submitRcaAndActionPlan,
} from "./engine";
import { DEFAULT_ACTION_ITEM_ENGINE_CONFIG } from "./types";
import type { PerformanceIssueState } from "./types";

/**
 * These tests reproduce spec section 27's exact scenarios verbatim. The
 * 4-week sustained-performance rule is the highest-risk piece of business
 * logic in the whole platform (section 26: "must be enforced
 * server-side/backend-side and covered by automated tests") — if these
 * ever fail, do not "fix the test," fix the engine.
 */
describe("section 27 — Quality target 90%, 6-week primary scenario", () => {
  it("OPEN -> MONITORING(1..3) -> SUSTAINED(4) -> COMPLETED(5th consecutive pass)", () => {
    const weeks = [
      { week: "W1", result: "FAIL" as const }, // 88% FAIL
      { week: "W2", result: "PASS" as const }, // 91% PASS
      { week: "W3", result: "PASS" as const }, // 92% PASS
      { week: "W4", result: "PASS" as const }, // 93% PASS
      { week: "W5", result: "PASS" as const }, // 94% PASS
      { week: "W6", result: "PASS" as const }, // 95% PASS
    ];

    const { history, issue } = runWeeklyHistory(weeks, undefined, {
      autoAcknowledgeAfterFailure: true,
    });

    expect(history[0].issue).toMatchObject({ status: "OPEN", consecutivePassingWeeks: 0 });
    expect(history[1].issue).toMatchObject({ status: "MONITORING", consecutivePassingWeeks: 1 });
    expect(history[2].issue).toMatchObject({ status: "MONITORING", consecutivePassingWeeks: 2 });
    expect(history[3].issue).toMatchObject({ status: "MONITORING", consecutivePassingWeeks: 3 });
    expect(history[4].issue).toMatchObject({ status: "SUSTAINED", consecutivePassingWeeks: 4 });
    expect(history[5].issue).toMatchObject({ status: "COMPLETED", consecutivePassingWeeks: 5 });

    expect(issue?.status).toBe("COMPLETED");
    expect(issue?.resolvedWeek).toBe("W6");
  });
});

describe("section 27 — alternative scenario (failure return resets the counter)", () => {
  it("FAIL, PASS, PASS, FAIL -> consecutive resets to 0, status REOPENED", () => {
    const weeks = [
      { week: "W1", result: "FAIL" as const },
      { week: "W2", result: "PASS" as const },
      { week: "W3", result: "PASS" as const },
      { week: "W4", result: "FAIL" as const },
    ];

    const { history } = runWeeklyHistory(weeks, undefined, {
      autoAcknowledgeAfterFailure: true,
    });

    // Inspect the outcome of the W4 failure directly, before the helper's
    // same-week auto-acknowledgement simulation catches the REOPENED issue
    // back up to AWAITING_AGENT_ACKNOWLEDGEMENT/ACKNOWLEDGED — a real
    // supervisor would see REOPENED the moment the failure lands, exactly
    // like this.
    expect(history[3].issue).toMatchObject({ status: "REOPENED", consecutivePassingWeeks: 0 });
  });
});

describe("evaluateWeeklyResult — no existing issue", () => {
  it("creates a new OPEN issue on failure", () => {
    const { issue, events } = evaluateWeeklyResult(null, "FAIL", "W1");
    expect(issue).toMatchObject({ status: "OPEN", consecutivePassingWeeks: 0, openedWeek: "W1" });
    expect(events).toContainEqual({ type: "ISSUE_OPENED", week: "W1" });
  });

  it("does nothing on a pass with no prior issue", () => {
    const { issue } = evaluateWeeklyResult(null, "PASS", "W1");
    expect(issue).toBeNull();
  });
});

describe("evaluateWeeklyResult — administrative pending states", () => {
  const openIssue: PerformanceIssueState = {
    status: "OPEN",
    consecutivePassingWeeks: 0,
    openedWeek: "W1",
  };

  it("a pass before RCA/acknowledgement does not start monitoring", () => {
    const { issue, events } = evaluateWeeklyResult(openIssue, "PASS", "W2");
    expect(issue).toMatchObject({ status: "OPEN", consecutivePassingWeeks: 0 });
    expect(events).toContainEqual({ type: "WEEK_PASSED_BEFORE_MONITORING", week: "W2" });
  });

  it("a repeated failure before monitoring starts stays OPEN, not REOPENED", () => {
    const { issue, events } = evaluateWeeklyResult(openIssue, "FAIL", "W2");
    expect(issue).toMatchObject({ status: "OPEN", consecutivePassingWeeks: 0 });
    expect(events).toContainEqual({ type: "WEEK_FAILED_WHILE_ACTIVE", week: "W2" });
  });
});

describe("submitRcaAndActionPlan / acknowledgeByAgent", () => {
  const openIssue: PerformanceIssueState = {
    status: "OPEN",
    consecutivePassingWeeks: 0,
    openedWeek: "W1",
  };

  it("moves OPEN -> AWAITING_AGENT_ACKNOWLEDGEMENT -> ACKNOWLEDGED", () => {
    const afterSubmit = submitRcaAndActionPlan(openIssue, "W1").issue;
    expect(afterSubmit.status).toBe("AWAITING_AGENT_ACKNOWLEDGEMENT");

    const afterAck = acknowledgeByAgent(afterSubmit, "W1").issue;
    expect(afterAck.status).toBe("ACKNOWLEDGED");
  });

  it("rejects submitting RCA/Action Plan from a non-OPEN/REOPENED status", () => {
    const monitoring: PerformanceIssueState = {
      status: "MONITORING",
      consecutivePassingWeeks: 2,
      openedWeek: "W1",
    };
    expect(() => submitRcaAndActionPlan(monitoring, "W3")).toThrow();
  });

  it("rejects acknowledgement outside AWAITING_AGENT_ACKNOWLEDGEMENT", () => {
    expect(() => acknowledgeByAgent(openIssue, "W1")).toThrow();
  });
});

describe("a completed issue does not reopen — a new failure opens a fresh thread", () => {
  it("starts a brand new issue rather than resurrecting the completed one", () => {
    const completed: PerformanceIssueState = {
      status: "COMPLETED",
      consecutivePassingWeeks: 5,
      openedWeek: "W1",
      resolvedWeek: "W6",
    };
    const { issue, events } = evaluateWeeklyResult(completed, "FAIL", "W10");
    expect(issue).toMatchObject({ status: "OPEN", consecutivePassingWeeks: 0, openedWeek: "W10" });
    expect(events).toContainEqual({ type: "ISSUE_OPENED", week: "W10" });
  });

  it("stays COMPLETED and inert on a later pass", () => {
    const completed: PerformanceIssueState = {
      status: "COMPLETED",
      consecutivePassingWeeks: 5,
      openedWeek: "W1",
      resolvedWeek: "W6",
    };
    const { issue } = evaluateWeeklyResult(completed, "PASS", "W10");
    expect(issue).toEqual(completed);
  });
});

describe("section 6 — multiple KPIs are tracked independently", () => {
  it("Quality and AHT issues for the same employee do not interfere with each other", () => {
    const qualityWeeks = [
      { week: "W1", result: "FAIL" as const },
      { week: "W2", result: "PASS" as const },
      { week: "W3", result: "PASS" as const },
      { week: "W4", result: "PASS" as const },
      { week: "W5", result: "PASS" as const },
    ];
    const ahtWeeks = [
      { week: "W1", result: "PASS" as const },
      { week: "W2", result: "FAIL" as const },
      { week: "W3", result: "PASS" as const },
      { week: "W4", result: "PASS" as const },
      { week: "W5", result: "PASS" as const },
    ];

    const quality = runWeeklyHistory(qualityWeeks, undefined, { autoAcknowledgeAfterFailure: true });
    const aht = runWeeklyHistory(ahtWeeks, undefined, { autoAcknowledgeAfterFailure: true });

    // Quality failed in W1, so by W5 it has 4 consecutive passes -> SUSTAINED.
    expect(quality.issue).toMatchObject({ status: "SUSTAINED", consecutivePassingWeeks: 4, openedWeek: "W1" });
    // AHT failed in W2, so by W5 it only has 3 consecutive passes -> still MONITORING.
    expect(aht.issue).toMatchObject({ status: "MONITORING", consecutivePassingWeeks: 3, openedWeek: "W2" });
  });
});

describe("configurable consecutive-pass requirement", () => {
  it("honors a non-default requiredConsecutivePasses", () => {
    const weeks = [
      { week: "W1", result: "FAIL" as const },
      { week: "W2", result: "PASS" as const },
      { week: "W3", result: "PASS" as const },
    ];
    const { issue } = runWeeklyHistory(
      weeks,
      { requiredConsecutivePasses: 2, ageOutAfterDays: 60, notMeasuredAfterWeeks: 6 },
      { autoAcknowledgeAfterFailure: true },
    );
    expect(issue).toMatchObject({ status: "SUSTAINED", consecutivePassingWeeks: 2 });
  });
});

describe("canAutoReplay — safety gate for rewriting an issue's already-folded history", () => {
  const clean = {
    status: "OPEN" as const,
    hasRca: false,
    hasActionPlan: false,
    hasNotes: false,
    hasOtherIssuesForKpi: false,
  };

  it("allows a plain OPEN issue with no human decisions on it", () => {
    expect(canAutoReplay(clean)).toBe(true);
  });

  it("allows REOPENED the same way, in principle", () => {
    expect(canAutoReplay({ ...clean, status: "REOPENED" })).toBe(true);
  });

  it("refuses once an RCA exists", () => {
    expect(canAutoReplay({ ...clean, hasRca: true })).toBe(false);
  });

  it("refuses once an action plan exists", () => {
    expect(canAutoReplay({ ...clean, hasActionPlan: true })).toBe(false);
  });

  it("refuses once a note exists", () => {
    expect(canAutoReplay({ ...clean, hasNotes: true })).toBe(false);
  });

  it("refuses when a prior episode exists for the same employee+KPI", () => {
    expect(canAutoReplay({ ...clean, hasOtherIssuesForKpi: true })).toBe(false);
  });

  it("refuses any status past OPEN/REOPENED even with no other flags set", () => {
    for (const status of ["AWAITING_AGENT_ACKNOWLEDGEMENT", "ACKNOWLEDGED", "MONITORING", "SUSTAINED", "COMPLETED"] as const) {
      expect(canAutoReplay({ ...clean, status })).toBe(false);
    }
  });
});

describe("replayEmployeeKpiHistory — rebuilding an issue's trajectory from current weekly data", () => {
  it("produces no issue and no history when every week passes", () => {
    const result = replayEmployeeKpiHistory([
      { week: "2026-08-01", status: "pass" },
      { week: "2026-08-08", status: "pass" },
    ]);
    expect(result.issue).toBeNull();
    expect(result.history).toEqual([]);
  });

  it("drops weeks before the first fail — an issue carries no history before it exists", () => {
    const result = replayEmployeeKpiHistory([
      { week: "2026-08-01", status: "pass" },
      { week: "2026-08-08", status: "fail" },
      { week: "2026-08-15", status: "pass" },
    ]);
    expect(result.history.map((h) => h.week)).toEqual(["2026-08-08", "2026-08-15"]);
    expect(result.history[0]).toEqual({ week: "2026-08-08", result: "fail", consecutiveCountAfter: 0 });
    // Passing while still OPEN (no RCA/ack in a pure replay) doesn't advance the counter.
    expect(result.history[1]).toEqual({ week: "2026-08-15", result: "pass", consecutiveCountAfter: 0 });
    expect(result.issue).toMatchObject({ status: "OPEN", openedWeek: "2026-08-08" });
  });

  it("treats a warning as a pass, matching the engine's own mapping", () => {
    const result = replayEmployeeKpiHistory([{ week: "2026-08-01", status: "warning" }]);
    expect(result.issue).toBeNull();
    expect(result.history).toEqual([]);
  });

  it("moves the opened week when an earlier fail is corrected to a pass", () => {
    // The real-world case this whole reconciliation exists for: a week that
    // opened an issue turns out, after a data correction, to have passed —
    // but a later week in the same run still genuinely fails.
    const result = replayEmployeeKpiHistory([
      { week: "2026-08-01", status: "pass" }, // was "fail" when the issue first opened
      { week: "2026-08-08", status: "fail" },
    ]);
    expect(result.issue).toMatchObject({ status: "OPEN", openedWeek: "2026-08-08" });
    expect(result.history).toEqual([{ week: "2026-08-08", result: "fail", consecutiveCountAfter: 0 }]);
  });
});

describe("shouldAgeOut", () => {
  const recovered = {
    status: "OPEN" as const,
    openedWeek: "2026-06-06",
    latestResult: "pass" as const,
  };

  it("closes a recovered issue once it passes the threshold", () => {
    expect(shouldAgeOut(recovered, "2026-08-07")).toBe(true); // 62 days
  });

  it("leaves a recovered issue alone before the threshold", () => {
    expect(shouldAgeOut(recovered, "2026-07-05")).toBe(false); // 29 days
  });

  it("never ages out an issue that is still failing, however old", () => {
    expect(
      shouldAgeOut({ ...recovered, latestResult: "fail" }, "2026-12-31"),
    ).toBe(false);
  });

  it("treats no result at all as not recovered", () => {
    expect(shouldAgeOut({ ...recovered, latestResult: null }, "2026-12-31")).toBe(false);
  });

  it("counts a warning as recovered — it is not a failure", () => {
    expect(shouldAgeOut({ ...recovered, latestResult: "warning" }, "2026-08-07")).toBe(true);
  });

  it("leaves an already completed issue alone", () => {
    expect(
      shouldAgeOut({ ...recovered, status: "COMPLETED" }, "2026-12-31"),
    ).toBe(false);
  });

  it("measures age from the most recent failure, not the week the item opened", () => {
    // Opened in June, relapsed on 10 August, passed the week after: 83 days
    // old by the opening week, 13 by the relapse. One passing week after a
    // relapse is not a recovery.
    const relapsed = { ...recovered, status: "REOPENED" as const, lastFailedWeek: "2026-08-10" };
    expect(shouldAgeOut(relapsed, "2026-08-23")).toBe(false);
    expect(shouldAgeOut(relapsed, "2026-10-12")).toBe(true); // 63 days after the relapse
  });

  it("ignores a failing week older than the opening week — an earlier episode's, not this one's", () => {
    expect(shouldAgeOut({ ...recovered, lastFailedWeek: "2026-01-05" }, "2026-08-07")).toBe(true);
  });

  it("treats no failure on record the same as the opening week", () => {
    expect(shouldAgeOut({ ...recovered, lastFailedWeek: null }, "2026-08-07")).toBe(true);
    expect(shouldAgeOut({ ...recovered, lastFailedWeek: null }, "2026-07-05")).toBe(false);
  });

  it("honours a different threshold", () => {
    expect(
      shouldAgeOut(recovered, "2026-06-20", {
        requiredConsecutivePasses: 4,
        ageOutAfterDays: 14,
        notMeasuredAfterWeeks: 6,
      }),
    ).toBe(true);
  });
});

describe("confirmedSeparations — the sweep acts only on separations the employee row confirms", () => {
  it("keeps a separation whose row is marked separated and drops every other", () => {
    const inferred = new Map([
      ["gone", "2026-08-31"],
      ["still-active", "2026-08-31"],
      ["on-leave", "2026-08-31"],
      ["unknown-row", "2026-08-31"],
    ]);
    const statusById = new Map([
      ["gone", "separated"],
      ["still-active", "active"],
      ["on-leave", "on_leave"],
    ]);
    expect([...confirmedSeparations(inferred, statusById)]).toEqual([["gone", "2026-08-31"]]);
  });

  it("is empty when nothing is confirmed", () => {
    expect(confirmedSeparations(new Map([["a", "2026-08-31"]]), new Map([["a", "active"]])).size).toBe(0);
  });
});

describe("separationResolutionWeeks — where the open work of someone who left is resolved", () => {
  // Stand-in for the reporting calendar: two July dates share a week.
  const weekStartOf = (date: string) =>
    ({ "2026-07-15": "2026-07-13", "2026-07-17": "2026-07-13", "2026-08-05": "2026-08-03" })[date] ??
    date;

  it("groups each issue under the week its owner's separation date falls in", () => {
    const byWeek = separationResolutionWeeks(
      [
        { id: "i1", employeeId: "a", openedWeek: "2026-06-01" },
        { id: "i2", employeeId: "b", openedWeek: "2026-06-01" },
        { id: "i3", employeeId: "a", openedWeek: "2026-06-01" },
        { id: "i4", employeeId: "c", openedWeek: "2026-06-01" },
      ],
      new Map([
        ["a", "2026-07-17"],
        ["b", "2026-07-15"],
        ["c", "2026-08-05"],
      ]),
      weekStartOf,
    );
    expect([...byWeek.entries()]).toEqual([
      ["2026-07-13", ["i1", "i2", "i3"]],
      ["2026-08-03", ["i4"]],
    ]);
  });

  it("leaves out an issue whose owner has no separation date", () => {
    const byWeek = separationResolutionWeeks(
      [
        { id: "i1", employeeId: "a", openedWeek: "2026-06-01" },
        { id: "i2", employeeId: "still-here", openedWeek: "2026-06-01" },
      ],
      new Map([["a", "2026-07-17"]]),
      weekStartOf,
    );
    expect([...byWeek.entries()]).toEqual([["2026-07-13", ["i1"]]]);
  });

  it("never resolves an issue before the week it opened", () => {
    // A masterlist closed her as of 31 July, after this month's weeks had
    // already opened work for her: that work ends the week it began, not
    // a week before it existed.
    const byWeek = separationResolutionWeeks(
      [
        { id: "before", employeeId: "a", openedWeek: "2026-06-01" },
        { id: "same-week", employeeId: "a", openedWeek: "2026-07-13" },
        { id: "after", employeeId: "a", openedWeek: "2026-08-03" },
      ],
      new Map([["a", "2026-07-17"]]),
      weekStartOf,
    );
    expect([...byWeek.entries()]).toEqual([
      ["2026-07-13", ["before", "same-week"]],
      ["2026-08-03", ["after"]],
    ]);
  });

  it("is empty when nobody has left", () => {
    expect(separationResolutionWeeks([{ id: "i1", employeeId: "a", openedWeek: "2026-06-01" }], new Map(), weekStartOf).size).toBe(0);
  });
});

describe("noLongerMeasured", () => {
  // The case this exists for: an item opened on a failing week, and then the
  // KPI went quiet — the agent moved queue, went on leave, or left the
  // account. Jake Potot's Fax item, opened 25 April on a fail, with nothing
  // recorded since.
  const stranded = {
    status: "OPEN" as const,
    latestResultWeek: "2026-04-25",
  };

  it("closes an item whose KPI has gone quiet for six weeks, though its last week failed", () => {
    // Six weeks to the day, and the five months Jake's actually sat there.
    expect(noLongerMeasured(stranded, "2026-06-06")).toBe(true);
    expect(noLongerMeasured(stranded, "2026-09-13")).toBe(true);
  });

  it("leaves it alone while the weeks are still arriving", () => {
    expect(noLongerMeasured(stranded, "2026-05-30")).toBe(false); // five weeks
    expect(noLongerMeasured(stranded, "2026-05-02")).toBe(false); // the next week
  });

  it("says nothing about whether the KPI passed or failed", () => {
    // The whole point: shouldAgeOut refuses a failing last week for ever, and
    // this rule does not look at the result at all. A pass, a fail and a
    // warning that all stopped on the same week close on the same day.
    expect(noLongerMeasured({ ...stranded, status: "MONITORING" }, "2026-09-13")).toBe(true);
    expect(noLongerMeasured({ ...stranded, status: "REOPENED" }, "2026-09-13")).toBe(true);
  });

  it("leaves an issue with nothing behind it alone", () => {
    // No last week to count six from, and an item with no results under it is
    // the kind to look at rather than close quietly.
    expect(noLongerMeasured({ ...stranded, latestResultWeek: null }, "2026-12-31")).toBe(false);
    expect(noLongerMeasured({ status: "OPEN" }, "2026-12-31")).toBe(false);
  });

  it("does not reopen anything already closed", () => {
    expect(noLongerMeasured({ ...stranded, status: "COMPLETED" }, "2026-12-31")).toBe(false);
  });

  it("honours a different threshold", () => {
    expect(noLongerMeasured(stranded, "2026-05-23", { ...DEFAULT_ACTION_ITEM_ENGINE_CONFIG, notMeasuredAfterWeeks: 4 })).toBe(true);
    expect(noLongerMeasured(stranded, "2026-05-23", { ...DEFAULT_ACTION_ITEM_ENGINE_CONFIG, notMeasuredAfterWeeks: 8 })).toBe(false);
  });

  it("is not thrown by an unparseable week", () => {
    expect(noLongerMeasured({ ...stranded, latestResultWeek: "not a date" }, "2026-09-13")).toBe(false);
    expect(noLongerMeasured(stranded, "not a date")).toBe(false);
  });
});

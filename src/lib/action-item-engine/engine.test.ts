import { describe, expect, it } from "vitest";
import {
  acknowledgeByAgent,
  evaluateWeeklyResult,
  runWeeklyHistory,
  submitRcaAndActionPlan,
} from "./engine";
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
      { requiredConsecutivePasses: 2 },
      { autoAcknowledgeAfterFailure: true },
    );
    expect(issue).toMatchObject({ status: "SUSTAINED", consecutivePassingWeeks: 2 });
  });
});

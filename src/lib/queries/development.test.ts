import { describe, expect, it } from "vitest";
import {
  NO_MANAGER,
  NO_TEAM_LEAD,
  assess,
  buildDevelopmentBoard,
  groupIntoRoster,
  supportRequested,
} from "./development";
import type { ActionItemListRow } from "./performance";

/**
 * The Development Hub's "next step" is read by three audiences with
 * different jobs. A leader is told what they owe; an agent is told whose
 * move it is, and is asked directly for the one step that is theirs; a
 * trainer or SME is told what was asked of them and where the item stands.
 */
function item(overrides: Partial<ActionItemListRow>): ActionItemListRow {
  return {
    actionItemId: "a1",
    actionItemCode: "PA-2026-000001",
    issueCode: "PI-2026-000001",
    status: "ACKNOWLEDGED",
    consecutivePassingWeeks: 0,
    openedWeek: "2026-08-03",
    employeeId: "e1",
    employeeName: "Someone",
    supervisorName: "Lead A",
    managerName: "Manager One",
    site: "CEBU",
    kpiName: "Quality",
    kpiCode: "QUALITY",
    hasRca: true,
    hasActionPlan: true,
    coachingRequired: false,
    trainingRequired: false,
    ...overrides,
  };
}

describe("assess — the leader's board", () => {
  it("names what the leader owes, most blocked first", () => {
    expect(assess([item({ hasRca: false })])).toEqual({ nextStep: "Record root cause", urgency: 0 });
    expect(assess([item({ hasActionPlan: false })])).toEqual({ nextStep: "Write action plan", urgency: 1 });
    expect(assess([item({ status: "AWAITING_AGENT_ACKNOWLEDGEMENT" })])).toEqual({
      nextStep: "Awaiting agent acknowledgement",
      urgency: 2,
    });
  });

  it("tells a leader a reopened item has to go back to the agent", () => {
    expect(assess([item({ status: "REOPENED" })])).toEqual({
      nextStep: "Reopened — update the plan and send it to the agent again",
      urgency: 3,
    });
  });

  it("reports monitoring progress once the workflow is caught up", () => {
    expect(assess([item({ status: "MONITORING", consecutivePassingWeeks: 2 })])).toEqual({
      nextStep: "Monitoring (2/4)",
      urgency: 4,
    });
    expect(assess([item({ status: "MONITORING", consecutivePassingWeeks: 3 })])).toEqual({
      nextStep: "Close to sustained (3/4)",
      urgency: 5,
    });
  });
});

describe("assess — the agent's own plan", () => {
  it("says whose move it is rather than handing the agent the supervisor's job", () => {
    expect(assess([item({ hasRca: false })], "agent").nextStep).toBe(
      "Your supervisor is recording the root cause",
    );
    expect(assess([item({ hasActionPlan: false })], "agent").nextStep).toBe(
      "Your supervisor is writing the action plan",
    );
    expect(assess([item({ status: "REOPENED" })], "agent").nextStep).toBe(
      "Reopened — your supervisor will update the plan",
    );
  });

  it("asks the agent directly for the one step that is theirs", () => {
    expect(assess([item({ status: "AWAITING_AGENT_ACKNOWLEDGEMENT" })], "agent")).toEqual({
      nextStep: "Acknowledge your plan",
      urgency: 2,
    });
  });

  it("keeps the same urgency order as the leader's board, so the rows sort alike", () => {
    expect(assess([item({ hasRca: false })], "agent").urgency).toBe(0);
    expect(assess([item({ status: "MONITORING", consecutivePassingWeeks: 1 })], "agent").urgency).toBe(4);
  });
});

describe("assess — a trainer's or SME's queue", () => {
  it("leads with what was asked of them", () => {
    expect(assess([item({ trainingRequired: true, status: "MONITORING", consecutivePassingWeeks: 1 })], "support").nextStep).toBe(
      "Training requested · monitoring (1/4)",
    );
    expect(assess([item({ coachingRequired: true, status: "AWAITING_AGENT_ACKNOWLEDGEMENT" })], "support").nextStep).toBe(
      "Coaching requested · awaiting the agent's acknowledgement",
    );
    expect(
      assess([item({ trainingRequired: true }), item({ actionItemId: "a2", coachingRequired: true, status: "REOPENED" })], "support")
        .nextStep,
    ).toBe("Training and coaching requested · reopened, plan being updated");
  });

  it("never reads as blocked on them — the root cause is the leader's to write", () => {
    expect(assess([item({ hasRca: false })], "support")).toEqual({
      nextStep: "No support requested · root cause not recorded yet",
      urgency: 0,
    });
  });
});

describe("supportRequested", () => {
  it("is either flag on the plan, and false with no plan", () => {
    expect(supportRequested(item({ coachingRequired: true }))).toBe(true);
    expect(supportRequested(item({ trainingRequired: true }))).toBe(true);
    expect(supportRequested(item({}))).toBe(false);
  });
});

describe("buildDevelopmentBoard", () => {
  const items = [
    item({ actionItemId: "1", employeeId: "e1", employeeName: "Zed", supervisorName: "Lead B", kpiName: "Quality", trainingRequired: true, status: "MONITORING", consecutivePassingWeeks: 3 }),
    item({ actionItemId: "2", employeeId: "e2", employeeName: "Amy", supervisorName: "Lead A", kpiName: "Quality", coachingRequired: true, hasRca: false, status: "OPEN" }),
    item({ actionItemId: "3", employeeId: "e3", employeeName: "Bob", supervisorName: "Lead A", kpiName: "Attendance", trainingRequired: true, coachingRequired: true }),
    item({ actionItemId: "4", employeeId: "e4", employeeName: "Cal", kpiName: "Quality", status: "COMPLETED" }),
  ];

  it("orders a leader's board by what is most blocked", () => {
    const board = buildDevelopmentBoard(items, "leader");
    expect(board.rows.map((r) => r.employeeName)).toEqual(["Amy", "Bob", "Zed"]);
    expect(board.totals).toMatchObject({ peopleInDevelopment: 3, openItems: 3, missingRca: 1, nearingClose: 1 });
  });

  it("orders a support queue by KPI, then by team leader, then by name", () => {
    const board = buildDevelopmentBoard(items.filter(supportRequested), "support");
    expect(board.rows.map((r) => [r.kpis[0], r.supervisorName, r.employeeName])).toEqual([
      ["Attendance", "Lead A", "Bob"],
      ["Quality", "Lead A", "Amy"],
      ["Quality", "Lead B", "Zed"],
    ]);
  });

  it("totals the support asked for and the items already counting weeks", () => {
    const board = buildDevelopmentBoard(items, "support");
    expect(board.totals).toMatchObject({ needsTraining: 2, needsCoaching: 2, monitoring: 2, nearingClose: 1 });
  });

  it("leaves completed items off the board", () => {
    const board = buildDevelopmentBoard(items, "leader");
    expect(board.rows.find((r) => r.employeeName === "Cal")).toBeUndefined();
  });
});

describe("groupIntoRoster", () => {
  const board = (items: ActionItemListRow[]) => buildDevelopmentBoard(items, "leader").rows;

  it("nests agents under their team leader, and leaders under their manager", () => {
    const roster = groupIntoRoster(
      board([
        item({ employeeId: "e1", employeeName: "Ana", supervisorName: "Lead A", managerName: "Mgr One" }),
        item({ employeeId: "e2", employeeName: "Ben", supervisorName: "Lead A", managerName: "Mgr One" }),
        item({ employeeId: "e3", employeeName: "Cara", supervisorName: "Lead B", managerName: "Mgr Two" }),
      ]),
    );

    expect(roster.map((m) => m.name).sort()).toEqual(["Mgr One", "Mgr Two"]);
    const one = roster.find((m) => m.name === "Mgr One")!;
    expect(one.teamLeadCount).toBe(1);
    expect(one.headcount).toBe(2);
    expect(one.teamLeads[0].agents.map((a) => a.employeeName)).toEqual(["Ana", "Ben"]);
  });

  it("keeps somebody the roster never placed, under a named bucket", () => {
    // A board that exists to make sure nobody goes unnoticed must not drop
    // the person whose supervisor the import forgot to record.
    const roster = groupIntoRoster(
      board([item({ employeeId: "e9", employeeName: "Unplaced", supervisorName: null, managerName: null })]),
    );

    expect(roster).toHaveLength(1);
    expect(roster[0].name).toBe(NO_MANAGER);
    expect(roster[0].teamLeads[0].name).toBe(NO_TEAM_LEAD);
    expect(roster[0].teamLeads[0].agents[0].employeeName).toBe("Unplaced");
  });

  it("rolls what a leader owes up across their whole team", () => {
    const roster = groupIntoRoster(
      board([
        item({ employeeId: "e1", supervisorName: "Lead A", hasRca: false, hasActionPlan: false }),
        item({ employeeId: "e2", supervisorName: "Lead A", hasRca: true, hasActionPlan: false }),
        item({ employeeId: "e3", supervisorName: "Lead A", status: "AWAITING_AGENT_ACKNOWLEDGEMENT" }),
        item({ employeeId: "e4", supervisorName: "Lead A", trainingRequired: true, coachingRequired: true }),
      ]),
    );

    expect(roster[0].teamLeads[0]).toMatchObject({
      headcount: 4,
      openItems: 4,
      missingRca: 1,
      missingPlan: 1,
      awaitingAcknowledgement: 1,
      needsTraining: 1,
      needsCoaching: 1,
    });
  });

  it("counts people nearing close, not items", () => {
    // The chip reads "1 nearing close" about one agent, even when two of
    // their items are both nearly there.
    const roster = groupIntoRoster(
      board([
        item({ employeeId: "e1", supervisorName: "Lead A", kpiName: "Quality", consecutivePassingWeeks: 3 }),
        item({ employeeId: "e1", supervisorName: "Lead A", kpiName: "AHT", actionItemId: "a2", consecutivePassingWeeks: 3 }),
        item({ employeeId: "e2", supervisorName: "Lead A", consecutivePassingWeeks: 0 }),
      ]),
    );

    expect(roster[0].teamLeads[0].nearingClose).toBe(1);
  });

  it("names the KPI most of a team's items are about", () => {
    const roster = groupIntoRoster(
      board([
        item({ employeeId: "e1", supervisorName: "Lead A", kpiName: "Quality" }),
        item({ employeeId: "e2", supervisorName: "Lead A", kpiName: "Quality" }),
        item({ employeeId: "e3", supervisorName: "Lead A", kpiName: "AHT" }),
      ]),
    );

    expect(roster[0].teamLeads[0].topKpi).toEqual({ name: "Quality", count: 2 });
  });

  it("puts the leader who owes the most root causes at the top", () => {
    // The roster opens on the work, not on the alphabet.
    const roster = groupIntoRoster(
      board([
        item({ employeeId: "e1", supervisorName: "Zeta", hasRca: false, hasActionPlan: false }),
        item({ employeeId: "e2", supervisorName: "Alpha" }),
      ]),
    );

    expect(roster[0].teamLeads.map((l) => l.name)).toEqual(["Zeta", "Alpha"]);
  });

  it("names a team by the site most of it is at, rather than whoever sorts first", () => {
    const roster = groupIntoRoster(
      board([
        item({ employeeId: "e1", supervisorName: "Lead A", site: "MANILA" }),
        item({ employeeId: "e2", supervisorName: "Lead A", site: "CEBU" }),
        item({ employeeId: "e3", supervisorName: "Lead A", site: "CEBU" }),
      ]),
    );

    expect(roster[0].teamLeads[0].site).toBe("CEBU");
  });

  it("gives back nothing for a board with nobody on it", () => {
    expect(groupIntoRoster([])).toEqual([]);
  });
});

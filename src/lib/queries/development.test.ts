import { describe, expect, it } from "vitest";
import { assess } from "./development";
import type { ActionItemListRow } from "./performance";

/**
 * The Development Hub's "next step" is read by two audiences with different
 * jobs. A leader is told what they owe; an agent is told whose move it is,
 * and is asked directly for the one step that is theirs.
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
    kpiName: "Quality",
    kpiCode: "QUALITY",
    hasRca: true,
    hasActionPlan: true,
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
    expect(assess([item({ hasRca: false })], true).nextStep).toBe(
      "Your supervisor is recording the root cause",
    );
    expect(assess([item({ hasActionPlan: false })], true).nextStep).toBe(
      "Your supervisor is writing the action plan",
    );
    expect(assess([item({ status: "REOPENED" })], true).nextStep).toBe(
      "Reopened — your supervisor will update the plan",
    );
  });

  it("asks the agent directly for the one step that is theirs", () => {
    expect(assess([item({ status: "AWAITING_AGENT_ACKNOWLEDGEMENT" })], true)).toEqual({
      nextStep: "Acknowledge your plan",
      urgency: 2,
    });
  });

  it("keeps the same urgency order as the leader's board, so the rows sort alike", () => {
    expect(assess([item({ hasRca: false })], true).urgency).toBe(0);
    expect(assess([item({ status: "MONITORING", consecutivePassingWeeks: 1 })], true).urgency).toBe(4);
  });
});

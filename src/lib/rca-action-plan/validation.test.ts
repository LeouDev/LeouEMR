import { describe, expect, it } from "vitest";
import { actionPlanSchema, rcaSchema } from "./validation";

const validRca = {
  actionItemId: "11111111-1111-4111-8111-111111111111",
  problemStatement: "The agent missed target for three consecutive weeks.",
  rootCauseCategoryId: "22222222-2222-4222-8222-222222222222",
  rootCauseDetails: "System outages during the second week reduced available hours.",
};

const validPlan = {
  actionItemId: "11111111-1111-4111-8111-111111111111",
  correctiveAction: "Daily check-ins with the supervisor for two weeks.",
  expectedBehavior: "Meets the weekly CPH target without supervision.",
  targetMetric: "CPH",
  targetValue: 11,
  dueDate: "2026-10-01",
  followUpDate: "2026-10-15",
  coachingRequired: true,
  trainingRequired: false,
};

describe("rcaSchema", () => {
  it("accepts a normal submission", () => {
    expect(rcaSchema.safeParse(validRca).success).toBe(true);
  });

  it("rejects a problem statement with no upper bound previously enforced", () => {
    // Every other free-text field in the app caps at 2000 characters; this
    // one had no cap at all until it was added — pin it so it cannot
    // silently regress back to unbounded.
    const result = rcaSchema.safeParse({ ...validRca, problemStatement: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("accepts exactly the limit", () => {
    expect(rcaSchema.safeParse({ ...validRca, rootCauseDetails: "x".repeat(2000) }).success).toBe(true);
  });

  it("rejects an oversized optional field", () => {
    expect(
      rcaSchema.safeParse({ ...validRca, contributingFactors: "x".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("actionPlanSchema", () => {
  it("accepts a normal submission", () => {
    expect(actionPlanSchema.safeParse(validPlan).success).toBe(true);
  });

  it("rejects an oversized corrective action", () => {
    expect(
      actionPlanSchema.safeParse({ ...validPlan, correctiveAction: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("rejects an oversized supervisor note", () => {
    expect(
      actionPlanSchema.safeParse({ ...validPlan, supervisorNotes: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("rejects an oversized target metric label", () => {
    expect(actionPlanSchema.safeParse({ ...validPlan, targetMetric: "x".repeat(201) }).success).toBe(false);
  });
});

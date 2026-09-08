import { describe, expect, it } from "vitest";
import { resolveTargets, stageFor, STANDARD, targetFor, type TargetSkill } from "./targets";

/** The Fax ladder as migration 0038 seeds it: Nesting 5.5, converging on 11. */
const FAX_RAMP = [5.5, 6.4, 6.9, 7.5, 8.1, 9.3, 9.8, 10.4, 11].map((target, stage) => ({
  stage,
  label: stage === 0 ? "Nesting" : `Week ${stage}`,
  target,
}));

const fax = (over: Partial<TargetSkill> = {}): TargetSkill => ({
  code: "fax",
  name: "Fax",
  target: 11,
  ramp: FAX_RAMP,
  currentStage: null,
  ...over,
});

/** GLP-1 has no ramp schedule configured, which is the common case. */
const glp1: TargetSkill = { code: "glp_1", name: "GLP_1", target: 15, ramp: [], currentStage: null };

describe("which stage applies", () => {
  it("uses the steady-state target for someone not ramping", () => {
    expect(stageFor(fax(), {})).toBeNull();
    expect(targetFor(fax(), null)).toBe(11);
  });

  it("uses the employee's own assignment when they have not chosen", () => {
    expect(stageFor(fax({ currentStage: 3 }), {})).toBe(3);
    expect(targetFor(fax(), 3)).toBe(7.5);
  });

  it("lets an explicit choice override the assignment", () => {
    expect(stageFor(fax({ currentStage: 3 }), { fax: 6 })).toBe(6);
    expect(targetFor(fax(), 6)).toBe(9.8);
  });

  it("lets someone opt out of their ramp entirely", () => {
    expect(stageFor(fax({ currentStage: 2 }), { fax: STANDARD })).toBeNull();
  });

  it("falls back rather than pinning to a stage the schedule no longer has", () => {
    // A stage removed from the schedule must not leave the agent on a target
    // that no longer exists.
    expect(stageFor(fax({ currentStage: 1 }), { fax: 99 })).toBe(1);
    expect(targetFor(fax(), 99)).toBe(11);
  });

  it("ignores a choice for a skill with no ramp ladder", () => {
    expect(stageFor(glp1, { glp_1: 4 })).toBeNull();
    expect(targetFor(glp1, 4)).toBe(15);
  });

  it("treats a completed ramp as steady state", () => {
    // rampStageForWeek returns null past week 8.
    expect(stageFor(fax({ currentStage: null }), {})).toBeNull();
  });
});

describe("resolving every skill at once", () => {
  it("names the ramp week it used, and leaves it null otherwise", () => {
    const targets = resolveTargets([fax({ currentStage: 1 }), glp1], {});
    expect(targets.get("fax")).toEqual({
      code: "fax",
      name: "Fax",
      target: 6.4,
      rampStageLabel: "Week 1",
    });
    expect(targets.get("glp_1")).toEqual({
      code: "glp_1",
      name: "GLP_1",
      target: 15,
      rampStageLabel: null,
    });
  });

  it("labels stage 0 as Nesting rather than Week 0", () => {
    expect(resolveTargets([fax({ currentStage: 0 })], {}).get("fax")).toMatchObject({
      target: 5.5,
      rampStageLabel: "Nesting",
    });
  });

  it("converges on the steady-state target at week 8", () => {
    // The migration seeds week 8 equal to skill_references.target on purpose.
    expect(targetFor(fax(), 8)).toBe(fax().target);
  });
});

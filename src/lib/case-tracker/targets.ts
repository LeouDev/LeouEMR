import { stageLabel } from "@/lib/ramp/engine";
import type { SkillTarget } from "./tracker";

/** One selectable ramp stage, as the schedule configures it for a skill. */
export interface RampOption {
  stage: number;
  label: string;
  target: number;
}

/** A skill the tracker can hold a day to, with whatever ramp ladder it has. */
export interface TargetSkill {
  code: string;
  name: string;
  /** Steady-state target from skill_references, in cases per hour. */
  target: number;
  /** Configured ramp stages, ascending. Empty when the skill has no schedule. */
  ramp: RampOption[];
  /** Where this employee's own ramp assignment puts them today, if they have one. */
  currentStage: number | null;
}

/**
 * Chosen in place of a stage to mean "ignore my ramp, hold me to the standard
 * target". Distinct from "nothing chosen", which defers to the assignment.
 */
export const STANDARD = -1;

/**
 * Which ramp stage a skill is being held to.
 *
 * An explicit choice wins; otherwise the stage the employee's own assignment
 * puts them on, which is null both for someone not ramping and for someone
 * whose ramp has run past week 8. A stored choice that no longer matches a
 * configured stage falls back the same way, so editing the ramp schedule
 * cannot leave an agent pinned to a target that no longer exists.
 */
export function stageFor(skill: TargetSkill, chosen: Record<string, number>): number | null {
  const pick = chosen[skill.code];
  if (pick === STANDARD) return null;
  if (pick !== undefined && skill.ramp.some((option) => option.stage === pick)) return pick;
  return skill.currentStage;
}

/** The target in force for a skill, given its stage. */
export function targetFor(skill: TargetSkill, stage: number | null): number {
  if (stage === null) return skill.target;
  return skill.ramp.find((option) => option.stage === stage)?.target ?? skill.target;
}

/** Every skill's target for today, keyed by skill code. */
export function resolveTargets(
  skills: TargetSkill[],
  chosen: Record<string, number>,
): Map<string, SkillTarget> {
  return new Map(
    skills.map((skill) => {
      const stage = stageFor(skill, chosen);
      return [
        skill.code,
        {
          code: skill.code,
          name: skill.name,
          target: targetFor(skill, stage),
          rampStageLabel: stage === null ? null : stageLabel(stage),
        },
      ];
    }),
  );
}

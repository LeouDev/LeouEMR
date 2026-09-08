import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employeeRampAssignments, skillRampSchedules, skillReferences } from "@/lib/db/schema";
import { skillCodesForActivities } from "@/lib/case-tracker/activities";
import type { RampOption, TargetSkill } from "@/lib/case-tracker/targets";
import { LAST_STAGE, rampStageForWeek, stageLabel } from "@/lib/ramp/engine";

/**
 * The per-skill targets the case tracker holds a day to.
 *
 * Only the skills the tracked IEX activities map onto, so the dropdown an
 * agent picks from is the six queues they actually sit in rather than all
 * twenty reference skills.
 *
 * Ramp stages come from the same skill_ramp_schedules the import pipeline
 * scores against, not a second table of numbers kept here — a ramp target
 * edited for the org has to move the tracker with it. Where an employee has
 * an assignment, their current stage is resolved with the same
 * `rampStageForWeek` the ramp board uses, so the tool and the board cannot
 * disagree about which week someone is on.
 */
export async function getTrackerSkills(
  employeeId: string,
  asOf: string,
): Promise<TargetSkill[]> {
  const codes = skillCodesForActivities();

  const skills = await db
    .select({
      id: skillReferences.id,
      code: skillReferences.code,
      name: skillReferences.name,
      target: skillReferences.target,
    })
    .from(skillReferences)
    .where(and(inArray(skillReferences.code, codes), eq(skillReferences.active, true)));

  if (skills.length === 0) return [];

  const ids = skills.map((s) => s.id);
  const [schedules, assignments] = await Promise.all([
    db
      .select({
        skillReferenceId: skillRampSchedules.skillReferenceId,
        stage: skillRampSchedules.stage,
        target: skillRampSchedules.target,
      })
      .from(skillRampSchedules)
      .where(inArray(skillRampSchedules.skillReferenceId, ids)),
    db
      .select({
        skillReferenceId: employeeRampAssignments.skillReferenceId,
        rampStartWeek: employeeRampAssignments.rampStartWeek,
      })
      .from(employeeRampAssignments)
      .where(
        and(
          eq(employeeRampAssignments.employeeId, employeeId),
          inArray(employeeRampAssignments.skillReferenceId, ids),
        ),
      ),
  ]);

  const rampBySkill = new Map<string, RampOption[]>();
  for (const row of schedules) {
    if (row.stage < 0 || row.stage > LAST_STAGE) continue;
    const list = rampBySkill.get(row.skillReferenceId) ?? [];
    list.push({ stage: row.stage, label: stageLabel(row.stage), target: row.target });
    rampBySkill.set(row.skillReferenceId, list);
  }
  for (const list of rampBySkill.values()) list.sort((a, b) => a.stage - b.stage);

  const startBySkill = new Map(assignments.map((a) => [a.skillReferenceId, a.rampStartWeek]));

  // Order follows the activity list rather than the reference table's own
  // sort, so the dropdown reads in the order the activities were given.
  const order = new Map(codes.map((code, i) => [code, i]));

  return skills
    .map((skill) => {
      const start = startBySkill.get(skill.id);
      return {
        code: skill.code,
        name: skill.name,
        target: skill.target,
        ramp: rampBySkill.get(skill.id) ?? [],
        currentStage: start ? rampStageForWeek(start, asOf) : null,
      };
    })
    .sort((a, b) => (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99));
}

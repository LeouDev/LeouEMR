import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employeeRampAssignments, employees, skillReferences } from "@/lib/db/schema";
import { employeeScope } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { LAST_STAGE, rampStageForWeek, stageLabel } from "@/lib/ramp/engine";
import { getRampSchedulesBySkill } from "./ramp-schedule";

export interface RampRow {
  employeeId: string;
  eid: string;
  employeeName: string;
  skillReferenceId: string;
  skillName: string;
  rampStartWeek: string;
  /** Null once ramp is complete (past week 8) — the board only lists active ones. */
  stage: number;
  stageLabel: string;
  target: number;
}

export interface RampBoard {
  rows: RampRow[];
  /** Everyone the caller may start a ramp for, and the skills to choose from. */
  eligibleEmployees: Array<{ id: string; eid: string; name: string }>;
  skills: Array<{ id: string; name: string }>;
}

/**
 * Everyone currently ramping in the caller's scope, "now" meaning the
 * calendar week containing `asOf` — a board is for "where does this person
 * stand today", not a specific reporting period someone happens to be
 * filtering by elsewhere in the app.
 */
export async function getRampBoard(user: CurrentUser, asOf: string): Promise<RampBoard> {
  const scope = employeeScope(user);
  if (scope === null) return { rows: [], eligibleEmployees: [], skills: [] };

  const [assignments, roster, skills, schedulesBySkill] = await Promise.all([
    db
      .select({
        employeeId: employeeRampAssignments.employeeId,
        eid: employees.eid,
        employeeName: employees.name,
        skillReferenceId: employeeRampAssignments.skillReferenceId,
        skillName: skillReferences.name,
        rampStartWeek: employeeRampAssignments.rampStartWeek,
      })
      .from(employeeRampAssignments)
      .innerJoin(employees, eq(employees.id, employeeRampAssignments.employeeId))
      .innerJoin(skillReferences, eq(skillReferences.id, employeeRampAssignments.skillReferenceId))
      .where(scope === "all" ? undefined : scope),
    db
      .select({ id: employees.id, eid: employees.eid, name: employees.name })
      .from(employees)
      .where(scope === "all" ? undefined : scope)
      .orderBy(employees.name),
    db
      .select({ id: skillReferences.id, name: skillReferences.name })
      .from(skillReferences)
      .where(eq(skillReferences.active, true))
      .orderBy(skillReferences.name),
    getRampSchedulesBySkill(),
  ]);

  const rows: RampRow[] = [];
  for (const a of assignments) {
    const stage = rampStageForWeek(a.rampStartWeek, asOf);
    if (stage === null) continue; // not yet started, or already completed
    const target = schedulesBySkill.get(a.skillReferenceId)?.get(stage);
    if (target === undefined) continue;

    rows.push({
      employeeId: a.employeeId,
      eid: a.eid,
      employeeName: a.employeeName,
      skillReferenceId: a.skillReferenceId,
      skillName: a.skillName,
      rampStartWeek: a.rampStartWeek,
      stage,
      stageLabel: stageLabel(stage),
      target,
    });
  }

  rows.sort((x, y) => x.stage - y.stage || x.employeeName.localeCompare(y.employeeName));

  return {
    rows,
    eligibleEmployees: roster,
    skills,
  };
}

export { LAST_STAGE };

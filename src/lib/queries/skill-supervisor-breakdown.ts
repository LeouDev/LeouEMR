import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employeeAssignments, employees, skillFacts } from "@/lib/db/schema";
import { normalize, loadSkillReferences } from "@/lib/import-pipeline/par-scoring";
import { eligibleForPeriod } from "./eligibility";
import { assignmentAt, supervisorOfRecord } from "./org-history";
import type { Period } from "./period";

export interface SkillSupervisorRow {
  supervisor: string;
  skillCode: string;
  skillName: string;
  hours: number;
  cases: number;
  /** cases / hours, for every skill — including the case_rate ones. */
  cph: number | null;
  /** Seconds per case, for every skill. */
  aht: number | null;
}

const UNASSIGNED = "Unassigned";

/**
 * CPH and AHT, every skill, grouped by supervisor — informational, unlike
 * the MBO-attainment queries beside this one.
 *
 * Deliberately computed the same way for every skill regardless of its
 * configured scoring metric: for a case_rate skill, prod_weight/cases is
 * cases/hours exactly (prod_weight is cases² / hours in this data, verified
 * against production), so cases-per-hour is not an approximation for those
 * skills, it is the same number their case_rate metric already reduces to.
 * AHT is just the reciprocal view, seconds per case, useful for the same
 * skill whichever way someone prefers to read throughput. Neither of these
 * is the skill's SCORED metric — that stays exactly as configured
 * everywhere ratings are computed (see measureSkill in par-scoring.ts) —
 * this is a supplementary read of the same underlying facts.
 */
export async function getSkillMetricsBySupervisor(period: Period): Promise<SkillSupervisorRow[]> {
  const roster = await db
    .select({ employeeId: employees.id, supervisor: supervisorOfRecord })
    .from(employees)
    .leftJoin(employeeAssignments, assignmentAt(period.end));

  const eligible = new Set(await eligibleForPeriod(roster.map((r) => r.employeeId), period));
  const supervisorById = new Map(
    roster.filter((r) => eligible.has(r.employeeId)).map((r) => [r.employeeId, r.supervisor ?? UNASSIGNED]),
  );
  if (supervisorById.size === 0) return [];

  const facts = await db
    .select({
      employeeId: skillFacts.employeeId,
      skillLabel: skillFacts.skillLabel,
      cases: sql<number>`sum(${skillFacts.cases})::double precision`,
      hours: sql<number>`sum(${skillFacts.hours})::double precision`,
    })
    .from(skillFacts)
    .where(
      and(
        inArray(skillFacts.employeeId, [...supervisorById.keys()]),
        gte(skillFacts.factDate, period.start),
        lte(skillFacts.factDate, period.end),
      ),
    )
    .groupBy(skillFacts.employeeId, skillFacts.skillLabel);

  const references = await loadSkillReferences();

  interface Bucket {
    supervisor: string;
    skillCode: string;
    skillName: string;
    hours: number;
    cases: number;
  }
  const bucket = new Map<string, Bucket>();
  for (const row of facts) {
    const supervisor = supervisorById.get(row.employeeId);
    if (!supervisor) continue;
    const ref = references.get(normalize(row.skillLabel));
    if (!ref) continue;

    const key = `${supervisor}\u0000${ref.code}`;
    const entry = bucket.get(key) ?? { supervisor, skillCode: ref.code, skillName: ref.name, hours: 0, cases: 0 };
    entry.hours += row.hours;
    entry.cases += row.cases;
    bucket.set(key, entry);
  }

  return [...bucket.values()].map((entry) => ({
    supervisor: entry.supervisor,
    skillCode: entry.skillCode,
    skillName: entry.skillName,
    hours: entry.hours,
    cases: entry.cases,
    cph: entry.hours > 0 ? entry.cases / entry.hours : null,
    aht: entry.cases > 0 ? (entry.hours / entry.cases) * 3600 : null,
  }));
}

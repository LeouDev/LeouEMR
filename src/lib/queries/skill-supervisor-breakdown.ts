import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { CACHE_TAG, cachedRead, serialized } from "@/lib/cache";
import { db } from "@/lib/db/client";
import { employees, skillFacts } from "@/lib/db/schema";
import { normalize, loadSkillReferences } from "@/lib/import-pipeline/par-scoring";
import { eligibleForPeriod } from "./eligibility";
import { joinPeriodOwner, periodOwnerSubquery, supervisorOfRecord } from "./org-history";
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
  /** How this skill is actually scored — not which of cph/aht above is meaningful to chart it by. */
  metric: "cph" | "aht" | "case_rate";
  /** True for an AHT skill: a lower cph/higher aht number is the good direction, the opposite of every other skill here. */
  lowerIsBetter: boolean;
}

const UNASSIGNED = "Unassigned";

/**
 * Rows meaningful on a cases-per-hour chart: everything except AHT skills,
 * where a LOWER number is the good direction — plotting one on the same
 * axis as skills where higher is better reads as a spike, not a skill.
 */
export function cphChartRows(rows: SkillSupervisorRow[]): SkillSupervisorRow[] {
  return rows.filter((r) => !r.lowerIsBetter);
}

/**
 * Rows meaningful on an average-handle-time chart: only genuine AHT skills —
 * a skill actually gauged by cases per hour or case rate has no real "seconds
 * per case" figure worth charting, only the reciprocal of a rate that isn't
 * how it's scored.
 */
export function ahtChartRows(rows: SkillSupervisorRow[]): SkillSupervisorRow[] {
  return rows.filter((r) => r.metric === "aht");
}

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
export const getSkillMetricsBySupervisor = cachedRead(
  "skill-metrics-by-supervisor",
  [CACHE_TAG.imports, CACHE_TAG.reference, CACHE_TAG.ews],
  (period: Period) => serialized("analytics", () => computeSkillMetricsBySupervisor(period)),
);

async function computeSkillMetricsBySupervisor(period: Period): Promise<SkillSupervisorRow[]> {
  const owner = periodOwnerSubquery(period);
  const roster = await db
    .select({ employeeId: employees.id, supervisor: supervisorOfRecord(owner) })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner));

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
    metric: "cph" | "aht" | "case_rate";
    lowerIsBetter: boolean;
  }
  const bucket = new Map<string, Bucket>();
  for (const row of facts) {
    const supervisor = supervisorById.get(row.employeeId);
    if (!supervisor) continue;
    const ref = references.get(normalize(row.skillLabel));
    if (!ref) continue;

    const key = `${supervisor}\u0000${ref.code}`;
    const entry =
      bucket.get(key) ??
      ({
        supervisor,
        skillCode: ref.code,
        skillName: ref.name,
        hours: 0,
        cases: 0,
        metric: ref.metric,
        lowerIsBetter: ref.lowerIsBetter,
      } satisfies Bucket);
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
    metric: entry.metric,
    lowerIsBetter: entry.lowerIsBetter,
  }));
}

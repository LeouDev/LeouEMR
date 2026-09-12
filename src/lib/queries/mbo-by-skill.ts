import { and, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { skillFacts } from "@/lib/db/schema";
import {
  loadSkillReferences,
  measureSkill,
  normalize,
} from "@/lib/import-pipeline/par-scoring";
import { computeSkillRating, computeSkillRatio } from "@/lib/kpi-engine/par-mbo";
import { eligibleForPeriod, hasReportableData } from "./eligibility";
import type { Period } from "./period";
import { foldSkillRows } from "@/lib/kpi-engine/skill-result";

export interface SkillAttainment {
  skillCode: string;
  skillName: string;
  /** Share of employee-periods meeting or exceeding their skill target. */
  passRate: number;
  scored: number;
  passing: number;
}

/**
 * MBO's production-rate gate, broken out per skill rather than per person.
 *
 * MBO itself has no "per skill" reading — it is a composite across a
 * person's whole KPI set — so this asks the nearest well-defined question:
 * of everyone who worked a given skill this period, what share hit that
 * skill's own rating gate (R3, on target)? Pooled over the whole period per
 * employee per skill rather than averaged week by week, the same principle
 * getMboOverview itself uses for the org-wide figure: a person with three
 * good weeks and one bad one should be judged on the period they actually
 * produced, not on an average of four separate verdicts.
 *
 * Scored through the exact same functions the import pipeline rates
 * production with (measureSkill, computeSkillRatio, computeSkillRating) —
 * not a second implementation of the rating curve.
 */
export async function getMboAttainmentBySkill(period: Period): Promise<SkillAttainment[]> {
  const rows = await db
    .select({
      employeeId: skillFacts.employeeId,
      skillLabel: skillFacts.skillLabel,
      cases: sql<number>`sum(${skillFacts.cases})::double precision`,
      hours: sql<number>`sum(${skillFacts.hours})::double precision`,
      prodWeight: sql<number>`sum(${skillFacts.prodWeight})::double precision`,
    })
    .from(skillFacts)
    .where(and(gte(skillFacts.factDate, period.start), lte(skillFacts.factDate, period.end)))
    .groupBy(skillFacts.employeeId, skillFacts.skillLabel);

  if (rows.length === 0) return [];

  const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
  const [eligible, reporting] = await Promise.all([
    eligibleForPeriod(employeeIds, period),
    hasReportableData(employeeIds, period),
  ]);
  const eligibleSet = new Set(eligible);
  const reportingSet = new Set(reporting);

  const references = await loadSkillReferences();

  // One row per configured skill per person, whatever the files called it
  // across the period (see foldSkillRows): rated apart, one skill counted
  // as two in this tree.
  const byEmployee = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!eligibleSet.has(row.employeeId) || !reportingSet.has(row.employeeId)) continue;
    byEmployee.set(row.employeeId, [...(byEmployee.get(row.employeeId) ?? []), row]);
  }
  const folded = [...byEmployee.values()].flatMap(
    (personRows) => foldSkillRows(personRows, (row) => references.get(normalize(row.skillLabel))).folded,
  );

  const totals = new Map<string, { name: string; scored: number; passing: number }>();
  for (const { ref, row } of folded) {
    const actual = measureSkill(ref.metric, row);
    if (actual === null) continue;

    const ratio = computeSkillRatio(actual, ref.target, ref.lowerIsBetter);
    const rating = computeSkillRating(ratio, ref.thresholds);

    const entry = totals.get(ref.code) ?? { name: ref.name, scored: 0, passing: 0 };
    entry.scored += 1;
    if (rating >= 3) entry.passing += 1;
    totals.set(ref.code, entry);
  }

  return [...totals.entries()]
    .map(([skillCode, entry]) => ({
      skillCode,
      skillName: entry.name,
      scored: entry.scored,
      passing: entry.passing,
      passRate: entry.scored > 0 ? (entry.passing / entry.scored) * 100 : 0,
    }))
    .sort((a, b) => b.scored - a.scored);
}

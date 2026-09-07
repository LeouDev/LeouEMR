import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { skillFacts } from "@/lib/db/schema";
import { computeSkillRating, computeSkillRatio } from "@/lib/kpi-engine/par-mbo";
import { normalizeSkill } from "@/lib/kpi-engine/quality-metrics";
import { loadRampTargets, loadSkillReferences, measureSkill } from "@/lib/import-pipeline/par-scoring";

export interface SkillWeekCell {
  cases: number;
  hours: number;
  prodWeight: number;
  actual: number | null;
  target: number | null;
  rating: number | null;
}

export interface SkillBreakdownRow {
  skillLabel: string;
  metric: "cph" | "aht" | "case_rate";
  lowerIsBetter: boolean;
  /** Keyed by weekStart, same keys as the caller's `weeks` list. */
  cells: Map<string, SkillWeekCell>;
}

function weekEndFor(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/**
 * What actually fed a blended KPI like Cases Per Hour or Production Rate,
 * broken out per skill per week.
 *
 * CPH and AHT are Σcases/Σhours across every skill mapped to that metric for
 * the week (see aggregate.ts) — an employee working two "cph" skills gets
 * one indistinguishable number there. This re-derives each contributing
 * skill's own rate straight from skill_facts, which still carries the skill
 * label the blended KPI ledger does not.
 */
export async function getEmployeeSkillBreakdown(
  employeeId: string,
  employeeEid: string,
  weeks: string[],
): Promise<SkillBreakdownRow[]> {
  if (weeks.length === 0) return [];

  const sortedWeeks = [...weeks].sort();
  const rangeStart = sortedWeeks[0];
  const rangeEnd = weekEndFor(sortedWeeks[sortedWeeks.length - 1]);
  const weekEndByStart = new Map(sortedWeeks.map((w) => [w, weekEndFor(w)]));

  const [facts, refs, rampTargets] = await Promise.all([
    db
      .select({
        skillLabel: skillFacts.skillLabel,
        factDate: skillFacts.factDate,
        cases: skillFacts.cases,
        hours: skillFacts.hours,
        prodWeight: skillFacts.prodWeight,
      })
      .from(skillFacts)
      .where(
        and(
          eq(skillFacts.employeeId, employeeId),
          gte(skillFacts.factDate, rangeStart),
          lte(skillFacts.factDate, rangeEnd),
        ),
      ),
    loadSkillReferences(),
    loadRampTargets(),
  ]);

  if (facts.length === 0) return [];

  // Group into employee's skill facts by skill label, then by the caller's
  // own week buckets — not a fresh derivation, so a straddling day can never
  // land somewhere the KPI matrix above it disagrees with.
  const bySkill = new Map<string, Map<string, { cases: number; hours: number; prodWeight: number }>>();
  for (const fact of facts) {
    const week = sortedWeeks.find((w) => fact.factDate >= w && fact.factDate <= weekEndByStart.get(w)!);
    if (!week) continue;

    const weekMap = bySkill.get(fact.skillLabel) ?? new Map();
    const totals = weekMap.get(week) ?? { cases: 0, hours: 0, prodWeight: 0 };
    totals.cases += fact.cases;
    totals.hours += fact.hours;
    totals.prodWeight += fact.prodWeight;
    weekMap.set(week, totals);
    bySkill.set(fact.skillLabel, weekMap);
  }

  const rows: SkillBreakdownRow[] = [];
  for (const [skillLabel, weekMap] of bySkill) {
    const ref = refs.get(normalizeSkill(skillLabel));
    if (!ref) continue; // an unconfigured label has no target/metric to rate against

    const cells = new Map<string, SkillWeekCell>();
    for (const [week, totals] of weekMap) {
      const actual = measureSkill(ref.metric, totals);
      const override = rampTargets.get(`${employeeEid}|${week}|${normalizeSkill(skillLabel)}`);
      const target = ref.lowerIsBetter ? (override?.ahtTarget ?? ref.target) : (override?.cphTarget ?? ref.target);
      const rating =
        actual !== null && target
          ? computeSkillRating(computeSkillRatio(actual, target, ref.lowerIsBetter), ref.thresholds)
          : null;
      cells.set(week, { ...totals, actual, target, rating });
    }

    rows.push({ skillLabel: ref.name, metric: ref.metric, lowerIsBetter: ref.lowerIsBetter, cells });
  }

  return rows.sort((a, b) => a.skillLabel.localeCompare(b.skillLabel));
}

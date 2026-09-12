import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { skillFacts } from "@/lib/db/schema";
import { computeSkillRating, computeSkillRatio } from "@/lib/kpi-engine/par-mbo";
import { loadRampTargets, loadSkillReferences, measureSkill, normalize } from "@/lib/import-pipeline/par-scoring";

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

  const rows: SkillBreakdownRow[] = [];
  for (const { ref, weeks: weekMap } of groupSkillFacts(facts, sortedWeeks, (label) => refs.get(normalize(label)))) {
    const cells = new Map<string, SkillWeekCell>();
    for (const [week, totals] of weekMap) {
      const actual = measureSkill(ref.metric, totals);
      // Ramp overrides are keyed by every label the skill goes by, its code
      // among them, so the merged row needs no particular source spelling.
      const override = rampTargets.get(`${employeeEid}|${week}|${normalize(ref.code)}`);
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

interface SkillTotals {
  cases: number;
  hours: number;
  prodWeight: number;
}

/**
 * Facts folded into one bucket per configured skill per week.
 *
 * Grouped by the skill a label resolves to, never by the label itself: a
 * source file that writes the same skill two ways across weeks — "Fax" one
 * month, "FAX " the next, or an alias — is one skill here, as it already is
 * in the supervisor and MBO roll-ups that key on the reference's code. It
 * used to be one row per distinct spelling, each carrying the reference's
 * name, so an employee page showed the same skill twice with the history
 * split between them at the week the spelling changed. Weeks are the
 * caller's own buckets, so a straddling day can never land somewhere the
 * KPI matrix above disagrees with; a label that resolves to no configured
 * skill has no target or metric to rate against and is left out.
 */
export function groupSkillFacts<Ref extends { code: string }>(
  facts: ReadonlyArray<{ skillLabel: string; factDate: string } & SkillTotals>,
  sortedWeeks: readonly string[],
  resolve: (label: string) => Ref | undefined,
): Array<{ ref: Ref; weeks: Map<string, SkillTotals> }> {
  const weekEndByStart = new Map(sortedWeeks.map((w) => [w, weekEndFor(w)]));
  const bySkill = new Map<string, { ref: Ref; weeks: Map<string, SkillTotals> }>();
  for (const fact of facts) {
    const ref = resolve(fact.skillLabel);
    if (!ref) continue;
    const week = sortedWeeks.find((w) => fact.factDate >= w && fact.factDate <= weekEndByStart.get(w)!);
    if (!week) continue;

    const entry = bySkill.get(ref.code) ?? { ref, weeks: new Map<string, SkillTotals>() };
    const totals = entry.weeks.get(week) ?? { cases: 0, hours: 0, prodWeight: 0 };
    totals.cases += fact.cases;
    totals.hours += fact.hours;
    totals.prodWeight += fact.prodWeight;
    entry.weeks.set(week, totals);
    bySkill.set(ref.code, entry);
  }
  return [...bySkill.values()];
}

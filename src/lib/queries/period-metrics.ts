import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  employees,
  kpiDefinitions,
  metricFacts,
  qualityFacts,
  skillFacts,
  weeklyMetricResults,
} from "@/lib/db/schema";
import { applySourceTarget, evaluateKpi } from "@/lib/kpi-engine/evaluate";
import type { KpiDefinition, KpiStatus } from "@/lib/kpi-engine/types";
import { computeSkillRating, computeSkillRatio } from "@/lib/kpi-engine/par-mbo";
import { computeQualityTotals, normalizeSkill } from "@/lib/kpi-engine/quality-metrics";
import { loadAttributesBySkill, loadRampTargets, loadSkillReferences, MBO_GATES } from "@/lib/import-pipeline/par-scoring";
import { periodsBetween } from "./period";
import type { Period } from "./period";

export interface PeriodMetric {
  employeeId: string;
  kpiCode: string;
  kpiName: string;
  /**
   * From the KPI definition, so callers never hardcode which way is good.
   * `range` and `boolean_match` exist in the enum but have no single good
   * direction, and callers treat them as "no improvement arrow".
   */
  direction: "higher_is_better" | "lower_is_better" | "range" | "boolean_match";
  actualValue: number;
  targetValue: number | null;
  status: KpiStatus;
  sampleSize: number;
}

/**
 * Computes each KPI over an arbitrary period by re-aggregating daily facts.
 *
 * Percentages and rates are recomputed from their summed components rather
 * than averaged, because averaging periods of unequal size gives the wrong
 * answer — a week with two audits would otherwise count as much as a week
 * with twenty.
 */
export async function getPeriodMetrics(
  employeeIds: string[],
  period: Period,
): Promise<PeriodMetric[]> {
  if (employeeIds.length === 0) return [];

  // A week is a label in the source data, not a date range: 2.6% of
  // production rows carry a Weekly label that disagrees with their own
  // completion date. Week granularity therefore reads the stored weekly
  // ledger, which follows the source's own labelling, rather than
  // re-deriving weeks from dates and quietly disagreeing with the
  // business's existing reports.
  if (period.granularity === "week") return getWeekMetrics(employeeIds, period.start);

  // These three are mutually independent — definitions is a small static
  // table, and facts/targetRows are unfiltered by it (byCode/byId are only
  // derived from definitions below, after all three are back) — so they run
  // concurrently rather than paying three round trips in a row.
  const [definitions, facts, targetRows] = await Promise.all([
    db.select().from(kpiDefinitions).where(eq(kpiDefinitions.active, true)),
    // Measured KPIs: sum the components, then apply the KPI's own rule.
    db
      .select({
        employeeId: metricFacts.employeeId,
        kpiId: metricFacts.kpiId,
        numerator: sql<number>`sum(${metricFacts.numerator})::double precision`,
        denominator: sql<number>`sum(${metricFacts.denominator})::double precision`,
        sampleSize: sql<number>`sum(${metricFacts.sampleSize})::int`,
      })
      .from(metricFacts)
      .where(
        and(
          inArray(metricFacts.employeeId, employeeIds),
          gte(metricFacts.factDate, period.start),
          lte(metricFacts.factDate, period.end),
        ),
      )
      .groupBy(metricFacts.employeeId, metricFacts.kpiId),
    /**
     * The target each employee was actually measured against.
     *
     * CPH and AHT targets come per employee from the source workbook — a
     * ramping agent and an Edits agent do not share the KPI's default. The
     * weekly ledger snapshots that target, so the period's target is the mean
     * of the weeks it covers. Without this, re-aggregating a month scored
     * everyone against the KPI default (11 cases per hour) and marked agents
     * on an 8 target as failing while they were comfortably above it.
     */
    db
      .select({
        employeeId: weeklyMetricResults.employeeId,
        kpiId: weeklyMetricResults.kpiId,
        target: sql<number | null>`avg(${weeklyMetricResults.targetValue})`,
      })
      .from(weeklyMetricResults)
      .where(
        and(
          inArray(weeklyMetricResults.employeeId, employeeIds),
          // Any week OVERLAPPING the period, not only one starting inside it.
          // Weeks run Saturday-Friday against calendar months, so the week that
          // straddles a month boundary starts in the previous month while its
          // daily facts land in this one. Matching on the start alone dropped
          // that week's target, and a month whose only data is the straddling
          // week fell back to the KPI default — reintroducing the very bug this
          // per-employee lookup exists to fix.
          gte(weeklyMetricResults.weekEnd, period.start),
          lte(weeklyMetricResults.weekStart, period.end),
        ),
      )
      .groupBy(weeklyMetricResults.employeeId, weeklyMetricResults.kpiId),
  ]);
  const byCode = new Map(definitions.map((d) => [d.code, d]));
  const byId = new Map(definitions.map((d) => [d.id, d]));

  const results: PeriodMetric[] = [];

  const targetFor = new Map(
    targetRows
      .filter((r) => r.target !== null)
      .map((r) => [`${r.employeeId}|${r.kpiId}`, Number(r.target)]),
  );

  for (const fact of facts) {
    const definition = byId.get(fact.kpiId);
    if (!definition) continue;

    const value = combine(definition.aggregation, fact.numerator, fact.denominator);
    if (value === null) continue;

    results.push(
      evaluated(
        fact.employeeId,
        definition,
        value,
        fact.sampleSize,
        targetFor.get(`${fact.employeeId}|${fact.kpiId}`),
      ),
    );
  }

  // PAR, DPU, DPO and MBO are derived from the per-skill facts.
  const derived = await computeDerived(employeeIds, period, byCode);
  results.push(...derived);

  return results;
}

/** Week granularity reads the labelled weekly ledger rather than the facts. */
async function getWeekMetrics(employeeIds: string[], weekStart: string): Promise<PeriodMetric[]> {
  const rows = await db
    .select({
      employeeId: weeklyMetricResults.employeeId,
      kpiCode: kpiDefinitions.code,
      kpiName: kpiDefinitions.name,
      direction: kpiDefinitions.direction,
      actualValue: weeklyMetricResults.actualValue,
      targetValue: weeklyMetricResults.targetValue,
      status: weeklyMetricResults.status,
      sampleSize: weeklyMetricResults.sampleSize,
    })
    .from(weeklyMetricResults)
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
    .where(
      and(
        inArray(weeklyMetricResults.employeeId, employeeIds),
        eq(weeklyMetricResults.weekStart, weekStart),
      ),
    );

  return rows.map((row) => ({
    employeeId: row.employeeId,
    kpiCode: row.kpiCode,
    kpiName: row.kpiName,
    direction: row.direction,
    actualValue: row.actualValue,
    targetValue: row.targetValue,
    status: row.status.toUpperCase() as KpiStatus,
    sampleSize: row.sampleSize ?? 0,
  }));
}

/** How a KPI's daily numerator/denominator facts combine into one measured value — shared with the import pipeline, which re-derives a week's value the same way rather than trusting one import's own local rollup. */
export function combine(
  aggregation: string,
  numerator: number,
  denominator: number,
): number | null {
  switch (aggregation) {
    case "ratio":
      return denominator > 0 ? numerator / denominator : null;
    case "ratio_pct":
      return denominator > 0 ? (numerator / denominator) * 100 : null;
    case "inverse_seconds":
      return numerator > 0 ? (denominator / numerator) * 3600 : null;
    case "sum":
      return numerator;
    default:
      return null;
  }
}

function evaluated(
  employeeId: string,
  definition: typeof kpiDefinitions.$inferSelect,
  value: number,
  sampleSize: number,
  /** The employee's own target, where the source supplies one. */
  sourceTarget?: number,
): PeriodMetric {
  const kpi: KpiDefinition = applySourceTarget(
    {
      code: definition.code,
      name: definition.name,
      type: definition.type,
      direction: definition.direction,
      target: definition.target ?? undefined,
      warningThreshold: definition.warningThreshold ?? undefined,
      failureThreshold: definition.failureThreshold ?? undefined,
      rangeMin: definition.rangeMin ?? undefined,
      rangeMax: definition.rangeMax ?? undefined,
      expected: definition.expectedBoolean ?? undefined,
    },
    sourceTarget,
  );

  return {
    employeeId,
    kpiCode: definition.code,
    kpiName: definition.name,
    direction: definition.direction,
    actualValue: value,
    targetValue: kpi.target ?? null,
    status: evaluateKpi(value, kpi).status,
    sampleSize,
  };
}

/** PAR rating, DPU, DPO and the MBO composite over the period. */
async function computeDerived(
  employeeIds: string[],
  period: Period,
  byCode: Map<string, typeof kpiDefinitions.$inferSelect>,
): Promise<PeriodMetric[]> {
  // A ramping employee's CPH/AHT target changes week to week (see
  // loadRampTargets), but PRODUCTION_RATE here is scored from cases/hours
  // summed across the whole period against a single ratio. Scoring that
  // sum against the skill's flat steady target — as if every week in the
  // period held them to the standard — is exactly the bug the standalone
  // CPH/AHT target average above already exists to avoid; this gives PAR
  // and MBO the same treatment: the plain average of whichever target
  // applied each week the period covers. An employee with no ramp
  // assignment gets the identical steady target back (the average of N
  // copies of the same number), so this changes nothing for anyone not
  // ramping.
  //
  // These three reference/config loads are independent of each other and of
  // everything below, so they run concurrently rather than paying three
  // round trips in a row.
  const [refs, attributes, rampTargets] = await Promise.all([
    loadSkillReferences(),
    loadAttributesBySkill(),
    loadRampTargets(),
  ]);
  const out: PeriodMetric[] = [];
  const weeksInPeriod = rampTargets.size > 0 ? periodsBetween("week", period.start, period.end) : [];
  const eidById = new Map<string, string>();
  if (weeksInPeriod.length > 0) {
    const rows = await db
      .select({ id: employees.id, eid: employees.eid })
      .from(employees)
      .where(inArray(employees.id, employeeIds));
    for (const row of rows) eidById.set(row.id, row.eid);
  }

  function effectiveTarget(
    employeeId: string,
    skillLabel: string,
    ref: { target: number; lowerIsBetter: boolean },
  ): number {
    const eid = eidById.get(employeeId);
    if (!eid || weeksInPeriod.length === 0) return ref.target;

    const label = normalizeSkill(skillLabel);
    const sum = weeksInPeriod.reduce((total, week) => {
      const override = rampTargets.get(`${eid}|${week.start}|${label}`);
      const weekTarget = ref.lowerIsBetter
        ? (override?.ahtTarget ?? ref.target)
        : (override?.cphTarget ?? ref.target);
      return total + weekTarget;
    }, 0);
    return sum / weeksInPeriod.length;
  }

  // skills and quality are independent queries against different tables —
  // fetched together rather than one after the other, since neither
  // processing loop below needs the other table's result.
  const [skills, quality] = await Promise.all([
    db
      .select({
        employeeId: skillFacts.employeeId,
        skillLabel: skillFacts.skillLabel,
        cases: sql<number>`sum(${skillFacts.cases})::double precision`,
        hours: sql<number>`sum(${skillFacts.hours})::double precision`,
        weightHours: sql<number>`sum(${skillFacts.weightHours})::double precision`,
        prodWeight: sql<number>`sum(${skillFacts.prodWeight})::double precision`,
      })
      .from(skillFacts)
      .where(
        and(
          inArray(skillFacts.employeeId, employeeIds),
          gte(skillFacts.factDate, period.start),
          lte(skillFacts.factDate, period.end),
        ),
      )
      .groupBy(skillFacts.employeeId, skillFacts.skillLabel),
    db
      .select({
        employeeId: qualityFacts.employeeId,
        skillLabel: qualityFacts.skillLabel,
        audits: sql<number>`sum(${qualityFacts.audits})::int`,
        imperfect: sql<number>`sum(${qualityFacts.imperfect})::int`,
        markdowns: sql<number>`sum(${qualityFacts.markdowns})::int`,
      })
      .from(qualityFacts)
      .where(
        and(
          inArray(qualityFacts.employeeId, employeeIds),
          gte(qualityFacts.factDate, period.start),
          lte(qualityFacts.factDate, period.end),
        ),
      )
      .groupBy(qualityFacts.employeeId, qualityFacts.skillLabel),
  ]);

  const rateByEmployee = new Map<string, { rate: number; skills: number }>();
  const grouped = new Map<string, typeof skills>();
  for (const row of skills) {
    grouped.set(row.employeeId, [...(grouped.get(row.employeeId) ?? []), row]);
  }

  for (const [employeeId, rows] of grouped) {
    let totalWeight = 0;
    const scored: Array<{ rating: number; weight: number }> = [];

    for (const row of rows) {
      const ref = refs.get(normalizeSkill(row.skillLabel));
      if (!ref) continue;

      const actual =
        ref.metric === "aht"
          ? row.cases > 0
            ? (row.hours / row.cases) * 3600
            : null
          : ref.metric === "case_rate"
            ? row.cases > 0 && row.prodWeight > 0
              ? row.prodWeight / row.cases
              : null
            : row.hours > 0
              ? row.cases / row.hours
              : null;
      if (actual === null || !ref.target) continue;

      const target = effectiveTarget(employeeId, row.skillLabel, ref);
      const rating = computeSkillRating(computeSkillRatio(actual, target, ref.lowerIsBetter), ref.thresholds);
      const weight = row.weightHours > 0 ? row.weightHours : row.hours;
      scored.push({ rating, weight });
      totalWeight += weight;
    }

    if (scored.length === 0 || totalWeight <= 0) continue;
    const rate = scored.reduce((sum, s) => sum + s.rating * (s.weight / totalWeight), 0);
    rateByEmployee.set(employeeId, { rate, skills: scored.length });

    const definition = byCode.get("PRODUCTION_RATE");
    if (definition) out.push(evaluated(employeeId, definition, rate, scored.length));
  }

  const qualityByEmployee = new Map<string, typeof quality>();
  for (const row of quality) {
    qualityByEmployee.set(row.employeeId, [...(qualityByEmployee.get(row.employeeId) ?? []), row]);
  }

  const gates = new Map<string, { dpu: number | null; dpo: number | null }>();
  for (const [employeeId, rows] of qualityByEmployee) {
    const totals = computeQualityTotals(
      rows.map((r) => ({
        skill: r.skillLabel,
        audits: r.audits,
        markdowns: r.markdowns,
        imperfect: r.imperfect,
      })),
      attributes,
    );
    gates.set(employeeId, { dpu: totals.dpu, dpo: totals.dpo });

    const dpuDef = byCode.get("DPU");
    if (dpuDef && totals.dpu !== null) out.push(evaluated(employeeId, dpuDef, totals.dpu, totals.audits));
    const dpoDef = byCode.get("DPO");
    if (dpoDef && totals.dpo !== null) out.push(evaluated(employeeId, dpoDef, totals.dpo, totals.attributes));
  }

  // MBO: share of applicable gates met. Absent data is skipped, never failed.
  const mboDef = byCode.get("MBO");
  if (mboDef) {
    for (const employeeId of new Set([...rateByEmployee.keys(), ...gates.keys()])) {
      const rate = rateByEmployee.get(employeeId);
      const gate = gates.get(employeeId);
      const checks: boolean[] = [];
      if (rate) checks.push(rate.rate >= MBO_GATES.productionRate);
      if (gate?.dpu !== null && gate?.dpu !== undefined) checks.push(gate.dpu >= MBO_GATES.dpu);
      if (gate?.dpo !== null && gate?.dpo !== undefined) checks.push(gate.dpo >= MBO_GATES.dpo);
      if (checks.length === 0) continue;

      const value = (checks.filter(Boolean).length / checks.length) * 100;
      out.push(evaluated(employeeId, mboDef, value, checks.length));
    }
  }

  return out;
}

/** The earliest and latest day with any recorded fact. */
export async function getFactDateRange(): Promise<{ first: string; last: string } | null> {
  const [row] = await db
    .select({
      first: sql<string | null>`min(${metricFacts.factDate})::text`,
      last: sql<string | null>`max(${metricFacts.factDate})::text`,
    })
    .from(metricFacts);

  return row?.first && row?.last ? { first: row.first, last: row.last } : null;
}

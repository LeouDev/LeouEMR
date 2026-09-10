import { and, eq, gte, lte, sql } from "drizzle-orm";
import { CACHE_TAG, cachedRead, serialized } from "@/lib/cache";
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
import { CASE_RATE_KPI_CODE, blendCaseRate } from "@/lib/kpi-engine/case-rate";
import { measureSkillWeek, skillKpiCode } from "@/lib/kpi-engine/skill-result";
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
  /**
   * Set when this KPI stands for one skill (see skill-result.ts). Anything
   * that lists "the KPIs" filters these out — `withoutSkills` — while the
   * work-item paths keep them.
   */
  skillReferenceId: string | null;
}

/** The KPIs proper: every metric that is not one skill's own result. */
export function withoutSkills(metrics: PeriodMetric[]): PeriodMetric[] {
  return metrics.filter((m) => m.skillReferenceId === null);
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

  // Computed once for the whole organisation per period and cached, then
  // narrowed to the caller's people here. A period's numbers are identical
  // for every viewer and change only when something is imported, a ramp is
  // set or a skill target edited — each of which evicts one of the tags
  // below — yet every dashboard, MBO, stack-rank and My Stats visit was
  // re-aggregating its own slice from the fact tables, the slowest thing
  // any page here does. Cache hits are the common case; the first viewer of
  // a period after a change pays the full organisation-wide cost once, on
  // everyone else's behalf.
  const wanted = new Set(employeeIds);
  const compact = await readOrgPeriodMetrics(period.granularity, period.start, period.end);
  return expand(compact).filter((m) => wanted.has(m.employeeId));
}

/**
 * The cached shape: one small KPI table plus one flat tuple per
 * employee-KPI, rather than a self-describing object per row. Cached
 * entries are JSON, and a whole organisation's month is thousands of rows —
 * this keeps an entry a fraction of the size of the array it stands for.
 */
interface CompactPeriodMetrics {
  kpis: Array<{
    code: string;
    name: string;
    direction: PeriodMetric["direction"];
    skillReferenceId: string | null;
  }>;
  /** [employeeId, kpi index, actual, target, status index, sample size] */
  rows: Array<[string, number, number, number | null, number, number]>;
}

const STATUS_ORDER: KpiStatus[] = ["PASS", "WARNING", "FAIL"];

function compact(metrics: PeriodMetric[]): CompactPeriodMetrics {
  const kpis: CompactPeriodMetrics["kpis"] = [];
  const indexByCode = new Map<string, number>();
  const rows: CompactPeriodMetrics["rows"] = [];
  for (const m of metrics) {
    let index = indexByCode.get(m.kpiCode);
    if (index === undefined) {
      index =
        kpis.push({
          code: m.kpiCode,
          name: m.kpiName,
          direction: m.direction,
          skillReferenceId: m.skillReferenceId,
        }) - 1;
      indexByCode.set(m.kpiCode, index);
    }
    rows.push([m.employeeId, index, m.actualValue, m.targetValue, STATUS_ORDER.indexOf(m.status), m.sampleSize]);
  }
  return { kpis, rows };
}

function expand(data: CompactPeriodMetrics): PeriodMetric[] {
  return data.rows.map(([employeeId, kpi, actualValue, targetValue, status, sampleSize]) => ({
    employeeId,
    kpiCode: data.kpis[kpi].code,
    kpiName: data.kpis[kpi].name,
    direction: data.kpis[kpi].direction,
    actualValue,
    targetValue,
    status: STATUS_ORDER[status],
    sampleSize,
    skillReferenceId: data.kpis[kpi].skillReferenceId,
  }));
}

// One organisation-wide aggregation at a time per server instance: a cold
// cache for two periods at once (My Stats asks for this month and last)
// would otherwise run two of these together, each holding up to three
// pooled connections — the fan-out that wedges Supabase's transaction
// pooler (see src/lib/db/client.ts and `serialized` in src/lib/cache.ts).
const readOrgPeriodMetrics = cachedRead(
  "org-period-metrics",
  [CACHE_TAG.imports, CACHE_TAG.reference, CACHE_TAG.ramp],
  (granularity: Period["granularity"], start: string, end: string) =>
    serialized("period-metrics", async () =>
      compact(await computeOrgPeriodMetrics({ granularity, start, end, label: "" })),
    ),
);

async function computeOrgPeriodMetrics(period: Period): Promise<PeriodMetric[]> {
  // A week is a label in the source data, not a date range: 2.6% of
  // production rows carry a Weekly label that disagrees with their own
  // completion date. Week granularity therefore reads the stored weekly
  // ledger, which follows the source's own labelling, rather than
  // re-deriving weeks from dates and quietly disagreeing with the
  // business's existing reports.
  if (period.granularity === "week") return getWeekMetrics(period.start);

  // These three are mutually independent — definitions is a small static
  // table, and facts/targetRows are unfiltered by it (byCode/byId are only
  // derived from definitions below, after all three are back) — so they run
  // concurrently rather than paying three round trips in a row.
  const [definitions, facts, targetRows] = await Promise.all([
    readKpiDefinitions(),
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
      .where(and(gte(metricFacts.factDate, period.start), lte(metricFacts.factDate, period.end)))
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

  // PAR, DPU, DPO, MBO, case rate and every skill's own result are derived
  // from the per-skill facts.
  const derived = await computeDerived(period, byCode);
  results.push(...derived);

  return results;
}

/**
 * The active KPI definitions — seeded by migration and read on every
 * period aggregation. Timestamps are left out on purpose: the cache stores
 * JSON, and a Date would come back a string.
 */
export type KpiDefinitionRow = Pick<
  typeof kpiDefinitions.$inferSelect,
  | "id"
  | "code"
  | "name"
  | "type"
  | "direction"
  | "target"
  | "warningThreshold"
  | "failureThreshold"
  | "rangeMin"
  | "rangeMax"
  | "expectedBoolean"
  | "aggregation"
  | "skillReferenceId"
>;

const readKpiDefinitions = cachedRead("kpi-definitions", [CACHE_TAG.reference], (): Promise<KpiDefinitionRow[]> =>
  db
    .select({
      id: kpiDefinitions.id,
      code: kpiDefinitions.code,
      name: kpiDefinitions.name,
      type: kpiDefinitions.type,
      direction: kpiDefinitions.direction,
      target: kpiDefinitions.target,
      warningThreshold: kpiDefinitions.warningThreshold,
      failureThreshold: kpiDefinitions.failureThreshold,
      rangeMin: kpiDefinitions.rangeMin,
      rangeMax: kpiDefinitions.rangeMax,
      expectedBoolean: kpiDefinitions.expectedBoolean,
      aggregation: kpiDefinitions.aggregation,
      skillReferenceId: kpiDefinitions.skillReferenceId,
    })
    .from(kpiDefinitions)
    .where(eq(kpiDefinitions.active, true)),
);

/** Week granularity reads the labelled weekly ledger rather than the facts. */
async function getWeekMetrics(weekStart: string): Promise<PeriodMetric[]> {
  const rows = await db
    .select({
      employeeId: weeklyMetricResults.employeeId,
      kpiCode: kpiDefinitions.code,
      kpiName: kpiDefinitions.name,
      direction: kpiDefinitions.direction,
      skillReferenceId: kpiDefinitions.skillReferenceId,
      actualValue: weeklyMetricResults.actualValue,
      targetValue: weeklyMetricResults.targetValue,
      status: weeklyMetricResults.status,
      sampleSize: weeklyMetricResults.sampleSize,
    })
    .from(weeklyMetricResults)
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
    .where(eq(weeklyMetricResults.weekStart, weekStart));

  return rows.map((row) => ({
    employeeId: row.employeeId,
    kpiCode: row.kpiCode,
    kpiName: row.kpiName,
    direction: row.direction,
    actualValue: row.actualValue,
    targetValue: row.targetValue,
    status: row.status.toUpperCase() as KpiStatus,
    sampleSize: row.sampleSize ?? 0,
    skillReferenceId: row.skillReferenceId,
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
  definition: KpiDefinitionRow,
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
    skillReferenceId: definition.skillReferenceId,
  };
}

/** PAR rating, DPU, DPO, the MBO composite and case rate over the period. */
async function computeDerived(
  period: Period,
  byCode: Map<string, KpiDefinitionRow>,
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
    const rows = await db.select({ id: employees.id, eid: employees.eid }).from(employees);
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
      .where(and(gte(skillFacts.factDate, period.start), lte(skillFacts.factDate, period.end)))
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
      .where(and(gte(qualityFacts.factDate, period.start), lte(qualityFacts.factDate, period.end)))
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

  // Case rate over the period: the same skill rows, summed across the
  // employee's case-rate skills and divided once — see blendCaseRate. The
  // target is the period's own (what the mix expected per case worked), so it
  // travels with the value the way a CPH/AHT source target does.
  const caseRateDef = byCode.get(CASE_RATE_KPI_CODE);
  if (caseRateDef) {
    for (const [employeeId, rows] of grouped) {
      const blended = blendCaseRate(
        rows.flatMap((row) => {
          const ref = refs.get(normalizeSkill(row.skillLabel));
          if (ref?.metric !== "case_rate" || !(ref.target > 0)) return [];
          return [{ cases: row.cases, prodWeight: row.prodWeight, targetPerCase: ref.target }];
        }),
      );
      if (blended) {
        out.push(
          evaluated(employeeId, caseRateDef, blended.rate, Math.round(blended.cases), blended.target),
        );
      }
    }
  }

  // Each skill on its own KPI (migration 0042), over the period: the skill's
  // formula on the summed cases, hours and weight, against the average of
  // the targets the employee was held to across the period's weeks — the
  // same effectiveTarget the rating above uses, so a ramping agent is
  // judged on the ramp. Thin weeks are excluded per measureSkillWeek.
  for (const [employeeId, rows] of grouped) {
    for (const row of rows) {
      const ref = refs.get(normalizeSkill(row.skillLabel));
      if (!ref) continue;
      const definition = byCode.get(skillKpiCode(ref.code));
      if (!definition) continue;
      const result = measureSkillWeek(ref.metric, row, effectiveTarget(employeeId, row.skillLabel, ref));
      if (!result) continue;
      out.push(evaluated(employeeId, definition, result.actual, Math.round(row.cases), result.target));
    }
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

/**
 * The earliest and latest day with any recorded fact. Read on nearly every
 * period-based page to build the period list; changes only on import.
 */
export const getFactDateRange = cachedRead(
  "fact-date-range",
  [CACHE_TAG.imports],
  async (): Promise<{ first: string; last: string } | null> => {
    const [row] = await db
      .select({
        first: sql<string | null>`min(${metricFacts.factDate})::text`,
        last: sql<string | null>`max(${metricFacts.factDate})::text`,
      })
      .from(metricFacts);

    return row?.first && row?.last ? { first: row.first, last: row.last } : null;
  },
);

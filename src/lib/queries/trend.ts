import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { kpiDefinitions, skillFacts, weeklyMetricResults } from "@/lib/db/schema";
import { normalizeSkill } from "@/lib/kpi-engine/quality-metrics";
import { loadSkillReferences } from "@/lib/import-pipeline/par-scoring";
import { periodContaining } from "./period";

export interface TrendPoint {
  /** The reporting week's start date; weeks run Saturday to Friday. */
  weekStart: string;
  value: number;
  /** Upper case, or null where the figure is not scored against a target. */
  status: string | null;
}

export interface TrendSeries {
  kpiCode: string;
  kpiName: string;
  /** From the KPI definition, so the chart never hardcodes which way is good. */
  direction: string;
  /** The most recent week's target, for the chart's target line. Null when unscored. */
  target: number | null;
  /** Ascending by week. Weeks with no result are omitted, not zero-filled. */
  points: TrendPoint[];
}

/**
 * One employee's week-by-week history for every KPI they are scored on.
 *
 * Reads the weekly ledger directly rather than re-aggregating daily facts: a
 * week is a label in the source data, not a date range, and the ledger follows
 * the source's own labelling — the same reason getPeriodMetrics short-circuits
 * to it at week granularity. That also makes the whole series one indexed
 * query instead of one aggregation per week.
 *
 * Missing weeks are left out rather than plotted as zero. A week with no
 * imported data is not a week of no performance, and a zero would drag a line
 * to the floor and read as a collapse.
 */
export async function getEmployeeKpiTrend(
  employeeId: string,
  /** Reporting week starts to plot, in any order; the result is sorted. */
  weekStarts: string[],
): Promise<TrendSeries[]> {
  if (weekStarts.length === 0) return [];
  const weeks = [...weekStarts].sort();

  const rows = await db
    .select({
      weekStart: weeklyMetricResults.weekStart,
      kpiCode: kpiDefinitions.code,
      kpiName: kpiDefinitions.name,
      direction: kpiDefinitions.direction,
      actualValue: weeklyMetricResults.actualValue,
      targetValue: weeklyMetricResults.targetValue,
      status: weeklyMetricResults.status,
    })
    .from(weeklyMetricResults)
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
    .where(
      and(
        eq(weeklyMetricResults.employeeId, employeeId),
        inArray(weeklyMetricResults.weekStart, weeks),
      ),
    );

  const byCode = new Map<string, TrendSeries>();
  for (const row of rows) {
    const series = byCode.get(row.kpiCode) ?? {
      kpiCode: row.kpiCode,
      kpiName: row.kpiName,
      direction: row.direction,
      target: null,
      points: [],
    };
    series.points.push({
      weekStart: row.weekStart,
      value: row.actualValue,
      status: row.status.toUpperCase(),
    });
    byCode.set(row.kpiCode, series);
  }

  // Targets can move week to week — a ramping agent's are lower — so the line
  // is drawn at the most recent one rather than an average that matches no
  // week actually plotted.
  for (const series of byCode.values()) {
    series.points.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    const latestWithTarget = [...rows]
      .filter((r) => r.kpiCode === series.kpiCode && r.targetValue !== null)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
    series.target = latestWithTarget?.targetValue ?? null;
  }

  const caseRate = await getCaseRateSeries(employeeId, weeks);
  if (caseRate) byCode.set(caseRate.kpiCode, caseRate);

  return [...byCode.values()];
}

/**
 * Case rate week by week, from the per-skill facts.
 *
 * Case rate is a skill metric rather than a KPI, so it has no row in the
 * weekly ledger at all — but it is the only output figure a case-rate agent
 * has, and leaving it off the chart would give them a metric they can see in
 * the grid and not plot. Unscored, for the same reason it is unscored in the
 * comparison table: each skill carries its own target.
 */
export async function getCaseRateByWeek(
  employeeId: string,
  /** Reporting week starts to cover. */
  weeks: string[],
): Promise<Map<string, number>> {
  if (weeks.length === 0) return new Map();
  const sorted = [...weeks].sort();
  const lastWeekEnd = periodContaining("week", sorted[sorted.length - 1]).end;

  const [rows, refs] = await Promise.all([
    db
      .select({
        factDate: skillFacts.factDate,
        skillLabel: skillFacts.skillLabel,
        cases: sql<number>`sum(${skillFacts.cases})::double precision`,
        prodWeight: sql<number>`sum(${skillFacts.prodWeight})::double precision`,
      })
      .from(skillFacts)
      .where(
        and(
          eq(skillFacts.employeeId, employeeId),
          gte(skillFacts.factDate, sorted[0]),
          lte(skillFacts.factDate, lastWeekEnd),
        ),
      )
      .groupBy(skillFacts.factDate, skillFacts.skillLabel),
    loadSkillReferences(),
  ]);

  // Bucketed with periodContaining rather than by date arithmetic here, so
  // these weeks are the same Saturday-to-Friday weeks the ledger uses.
  const wanted = new Set(sorted);
  const totals = new Map<string, { prodWeight: number; cases: number }>();
  for (const row of rows) {
    const ref = refs.get(normalizeSkill(row.skillLabel));
    if (ref?.metric !== "case_rate") continue;
    const weekStart = periodContaining("week", row.factDate).start;
    if (!wanted.has(weekStart)) continue;
    const entry = totals.get(weekStart) ?? { prodWeight: 0, cases: 0 };
    entry.prodWeight += row.prodWeight;
    entry.cases += row.cases;
    totals.set(weekStart, entry);
  }

  const rates = new Map<string, number>();
  for (const [week, t] of totals) {
    if (t.cases > 0 && t.prodWeight > 0) rates.set(week, t.prodWeight / t.cases);
  }
  return rates;
}

async function getCaseRateSeries(
  employeeId: string,
  /** Ascending week starts. */
  weeks: string[],
): Promise<TrendSeries | null> {
  const rates = await getCaseRateByWeek(employeeId, weeks);
  const points: TrendPoint[] = [...rates.entries()]
    .map(([weekStart, value]) => ({ weekStart, value, status: null }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  if (points.length === 0) return null;
  return {
    kpiCode: "CASE_RATE",
    kpiName: "Case Rate",
    direction: "higher_is_better",
    target: null,
    points,
  };
}

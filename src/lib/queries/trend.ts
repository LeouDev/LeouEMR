import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { kpiDefinitions, skillFacts, weeklyMetricResults } from "@/lib/db/schema";
import { CASE_RATE_KPI_CODE, blendCaseRate, type CaseRateSkillTotals } from "@/lib/kpi-engine/case-rate";
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
        // Skills are work items, not KPIs: they stay off the chips here.
        isNull(kpiDefinitions.skillReferenceId),
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

  // Case rate has been in the ledger since migration 0041; weeks imported
  // before that are filled from the per-skill facts. A ledger week always
  // wins, so this adds nothing once the ledger has been backfilled.
  const caseRate = await getCaseRateSeries(employeeId, weeks);
  if (caseRate) {
    const ledger = byCode.get(caseRate.kpiCode);
    if (!ledger) {
      byCode.set(caseRate.kpiCode, caseRate);
    } else {
      const have = new Set(ledger.points.map((p) => p.weekStart));
      ledger.points.push(...caseRate.points.filter((p) => !have.has(p.weekStart)));
      ledger.points.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      ledger.target ??= caseRate.target;
    }
  }

  return [...byCode.values()];
}

/**
 * Case rate week by week, from the per-skill facts — the same formula the
 * import writes to the ledger (see blendCaseRate), for the weeks that
 * predate case rate being a KPI. It is the only output figure a case-rate
 * agent has, and leaving those weeks off the chart would give them a metric
 * they can see in the grid and not plot.
 */
export interface WeeklyCaseRate {
  rate: number;
  /** What this agent's own skill mix expected of the cases they worked. */
  target: number;
  status: "PASS" | "FAIL";
}

export async function getCaseRateByWeek(
  employeeId: string,
  /** Reporting week starts to cover. */
  weeks: string[],
): Promise<Map<string, WeeklyCaseRate>> {
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
  const skillsByWeek = new Map<string, CaseRateSkillTotals[]>();
  for (const row of rows) {
    const ref = refs.get(normalizeSkill(row.skillLabel));
    if (ref?.metric !== "case_rate" || !(ref.target > 0)) continue;
    const weekStart = periodContaining("week", row.factDate).start;
    if (!wanted.has(weekStart)) continue;
    const list = skillsByWeek.get(weekStart) ?? [];
    list.push({ cases: row.cases, prodWeight: row.prodWeight, targetPerCase: ref.target });
    skillsByWeek.set(weekStart, list);
  }

  const rates = new Map<string, WeeklyCaseRate>();
  for (const [week, skills] of skillsByWeek) {
    const blended = blendCaseRate(skills);
    if (blended) rates.set(week, { rate: blended.rate, target: blended.target, status: blended.status });
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
    .map(([weekStart, r]) => ({ weekStart, value: r.rate, status: r.status }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  if (points.length === 0) return null;
  const latest = [...rates.entries()].sort((a, b) => b[0].localeCompare(a[0]))[0];
  return {
    kpiCode: CASE_RATE_KPI_CODE,
    kpiName: "Case Rate",
    direction: "higher_is_better",
    // The blend moves with the skill mix, so the line is drawn at the most
    // recent week's rather than an average matching no week actually plotted.
    target: latest?.[1].target ?? null,
    points,
  };
}

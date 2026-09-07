import { and, inArray, isNull, lte, or, sql, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { kpiDefinitions, performanceIssues, weeklyMetricResults } from "@/lib/db/schema";

export interface TeamTrendPoint {
  weekStart: string;
  /** Mean of the scored agents' values — the line. */
  avg: number;
  /** How many of them were below target that week — the bars. */
  below: number;
  scored: number;
}

export interface TeamTrendSeries {
  kpiCode: string;
  kpiName: string;
  direction: string;
  /** Mean target across the scored agents in the most recent week that has one. */
  target: number | null;
  /** Ascending by week; weeks with nobody scored are omitted. */
  points: TeamTrendPoint[];
}

/**
 * A team's week-by-week average for every KPI, with how many were below
 * target each week.
 *
 * Both halves come from one grouped read of the weekly ledger. The average
 * alone hides the shape of a team — one agent at 40% and nine at 100% averages
 * to a comfortable 94% — so the count below target is carried beside it and
 * drawn behind the line.
 *
 * Weeks with no result are omitted rather than zero-filled, for the same
 * reason as the individual trend: an unimported week is not a week of zero.
 */
export async function getTeamKpiTrend(
  employeeIds: string[],
  weekStarts: string[],
): Promise<TeamTrendSeries[]> {
  if (employeeIds.length === 0 || weekStarts.length === 0) return [];
  const weeks = [...weekStarts].sort();

  const rows = await db
    .select({
      weekStart: weeklyMetricResults.weekStart,
      kpiCode: kpiDefinitions.code,
      kpiName: kpiDefinitions.name,
      direction: kpiDefinitions.direction,
      avg: sql<number>`avg(${weeklyMetricResults.actualValue})::double precision`,
      below: sql<number>`count(*) filter (where ${weeklyMetricResults.status} = 'fail')::int`,
      scored: sql<number>`count(*)::int`,
      target: sql<number | null>`avg(${weeklyMetricResults.targetValue})::double precision`,
    })
    .from(weeklyMetricResults)
    .innerJoin(kpiDefinitions, sql`${kpiDefinitions.id} = ${weeklyMetricResults.kpiId}`)
    .where(
      and(
        inArray(weeklyMetricResults.employeeId, employeeIds),
        inArray(weeklyMetricResults.weekStart, weeks),
      ),
    )
    .groupBy(
      weeklyMetricResults.weekStart,
      kpiDefinitions.code,
      kpiDefinitions.name,
      kpiDefinitions.direction,
    );

  const byCode = new Map<string, TeamTrendSeries>();
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
      avg: row.avg,
      below: row.below,
      scored: row.scored,
    });
    byCode.set(row.kpiCode, series);
  }

  for (const series of byCode.values()) {
    series.points.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    // Targets move — a ramping agent's are lower — so the line is drawn at
    // the latest week that has one rather than an average over the range.
    const latest = [...rows]
      .filter((r) => r.kpiCode === series.kpiCode && r.target !== null)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
    series.target = latest?.target ?? null;
  }

  return [...byCode.values()];
}

export interface OrgTrendPoint {
  weekStart: string;
  /** The plotted value; a percentage for the rate series, a count for items. */
  value: number;
  /** Numerator and denominator behind the value, for the tooltip. */
  of: string;
}

export interface OrgTrendSeries {
  key: string;
  label: string;
  /** What the number means, shown beside the chart title. */
  note: string;
  target: number | null;
  /** Percent series are read against 100; a count has no ceiling. */
  unit: "percent" | "count";
  points: OrgTrendPoint[];
}

/**
 * Organization-level weekly series for the manager view.
 *
 * Fail rate and MBO pass rate are counted per week over the same weekly
 * ledger the rest of the app reports from. Open action items are counted as
 * "open at the end of that week" from each issue's own opened and resolved
 * weeks, so the line shows the backlog as it stood, not as it stands now.
 */
export async function getOrgTrend(
  employeeIds: string[],
  weekStarts: string[],
): Promise<OrgTrendSeries[]> {
  if (employeeIds.length === 0 || weekStarts.length === 0) return [];
  const weeks = [...weekStarts].sort();
  const lastWeek = weeks[weeks.length - 1];

  const [failRows, mboRows, issues] = await Promise.all([
    db
      .select({
        weekStart: weeklyMetricResults.weekStart,
        failing: sql<number>`count(distinct ${weeklyMetricResults.employeeId}) filter (where ${weeklyMetricResults.status} = 'fail')::int`,
        evaluated: sql<number>`count(distinct ${weeklyMetricResults.employeeId})::int`,
      })
      .from(weeklyMetricResults)
      .where(
        and(
          inArray(weeklyMetricResults.employeeId, employeeIds),
          inArray(weeklyMetricResults.weekStart, weeks),
        ),
      )
      .groupBy(weeklyMetricResults.weekStart),
    db
      .select({
        weekStart: weeklyMetricResults.weekStart,
        // MBO is a share of gates met, so clearing every gate is exactly 100.
        passing: sql<number>`count(*) filter (where ${weeklyMetricResults.actualValue} >= 100)::int`,
        scored: sql<number>`count(*)::int`,
      })
      .from(weeklyMetricResults)
      .innerJoin(kpiDefinitions, sql`${kpiDefinitions.id} = ${weeklyMetricResults.kpiId}`)
      .where(
        and(
          inArray(weeklyMetricResults.employeeId, employeeIds),
          inArray(weeklyMetricResults.weekStart, weeks),
          sql`${kpiDefinitions.code} = 'MBO'`,
        ),
      )
      .groupBy(weeklyMetricResults.weekStart),
    db
      .select({
        openedWeek: performanceIssues.openedWeek,
        resolvedWeek: performanceIssues.resolvedWeek,
      })
      .from(performanceIssues)
      .where(
        and(
          inArray(performanceIssues.employeeId, employeeIds),
          lte(performanceIssues.openedWeek, lastWeek),
          or(
            isNull(performanceIssues.resolvedWeek),
            gt(performanceIssues.resolvedWeek, weeks[0]),
          ),
        ),
      ),
  ]);

  const failByWeek = new Map(failRows.map((r) => [r.weekStart, r]));
  const mboByWeek = new Map(mboRows.map((r) => [r.weekStart, r]));

  const failRate: OrgTrendPoint[] = [];
  const mboPass: OrgTrendPoint[] = [];
  const openItems: OrgTrendPoint[] = [];

  for (const week of weeks) {
    const f = failByWeek.get(week);
    if (f && f.evaluated > 0) {
      failRate.push({
        weekStart: week,
        value: (f.failing / f.evaluated) * 100,
        of: `${f.failing} of ${f.evaluated} evaluated`,
      });
    }
    const m = mboByWeek.get(week);
    if (m && m.scored > 0) {
      mboPass.push({
        weekStart: week,
        value: (m.passing / m.scored) * 100,
        of: `${m.passing} of ${m.scored} scored`,
      });
    }
    // Counted from each issue's own span rather than its status today, so a
    // week that has since been worked down still shows the backlog it had.
    const open = issues.filter(
      (i) => i.openedWeek <= week && (i.resolvedWeek === null || i.resolvedWeek > week),
    ).length;
    openItems.push({ weekStart: week, value: open, of: `${open} open at week end` });
  }

  const all: OrgTrendSeries[] = [
    {
      key: "FAIL_RATE",
      label: "Fail rate",
      note: "share of agents failing at least one KPI",
      target: null,
      unit: "percent",
      points: failRate,
    },
    {
      key: "MBO_PASS",
      label: "MBO pass rate",
      note: "share clearing every gate",
      target: 90,
      unit: "percent",
      points: mboPass,
    },
    {
      key: "OPEN_ITEMS",
      label: "Open action items",
      note: "active at week end",
      target: null,
      unit: "count",
      points: openItems,
    },
  ];
  return all.filter((s) => s.points.length > 0);
}

import { and, inArray, isNull, lte, or, sql, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { kpiDefinitions, performanceIssues, weeklyMetricResults } from "@/lib/db/schema";
import { OPENS_ACTION_ITEMS } from "./performance";

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
        // Skills are work items, not KPIs: they stay off the chips here.
        isNull(kpiDefinitions.skillReferenceId),
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
  /** A percentage for the rate series, a count for open items. */
  value: number;
  /** What the value is made of, for the tooltip. */
  caption: string;
}

export interface OrgTrendSeries {
  key: string;
  label: string;
  /** What the number means, shown beside the chart title. */
  note: string;
  target: number | null;
  /** Percent series read against 100; a count has no ceiling. */
  unit: "percent" | "count";
  points: OrgTrendPoint[];
}

export interface OrgTrend {
  /** The manager's whole span. */
  whole: OrgTrendSeries[];
  /** The same series confined to one supervisor's team, keyed by name. */
  bySupervisor: Record<string, OrgTrendSeries[]>;
}

/**
 * Organization-level weekly series for the manager view, whole-span and per
 * supervisor.
 *
 * Stated as achievement rather than failure — the share meeting target, not
 * the share missing it. The two carry the same information, but a chart where
 * up is good reads the same way as every other chart on the page, and mixing
 * the two polarities in one row of chips invites reading a rise as a problem.
 *
 * The weekly rows are read once and every series is derived from them in
 * memory rather than issuing a query per supervisor per measure. A manager's
 * span is a few thousand rows over twelve weeks, which is far cheaper to
 * group here than to ask the database for a dozen times.
 *
 * Open action items are counted as "open at the end of that week" from each
 * issue's own opened and resolved weeks, so the line shows the backlog as it
 * stood rather than as it stands now — a resolved issue should not retitle
 * history as though it was never open.
 */
export async function getOrgTrend(
  roster: Array<{ employeeId: string; supervisorName: string | null }>,
  weekStarts: string[],
): Promise<OrgTrend> {
  if (roster.length === 0 || weekStarts.length === 0) return { whole: [], bySupervisor: {} };
  const weeks = [...weekStarts].sort();
  const employeeIds = roster.map((r) => r.employeeId);

  const [rows, issues] = await Promise.all([
    db
      .select({
        employeeId: weeklyMetricResults.employeeId,
        weekStart: weeklyMetricResults.weekStart,
        kpiCode: kpiDefinitions.code,
        kpiName: kpiDefinitions.name,
        status: weeklyMetricResults.status,
        actualValue: weeklyMetricResults.actualValue,
      })
      .from(weeklyMetricResults)
      .innerJoin(kpiDefinitions, sql`${kpiDefinitions.id} = ${weeklyMetricResults.kpiId}`)
      .where(
        and(
          inArray(weeklyMetricResults.employeeId, employeeIds),
          inArray(weeklyMetricResults.weekStart, weeks),
          // Skills are work items, not KPIs: they stay off the chips here.
          isNull(kpiDefinitions.skillReferenceId),
        ),
      ),
    db
      .select({
        employeeId: performanceIssues.employeeId,
        openedWeek: performanceIssues.openedWeek,
        resolvedWeek: performanceIssues.resolvedWeek,
      })
      .from(performanceIssues)
      .where(
        and(
          inArray(performanceIssues.employeeId, employeeIds),
          lte(performanceIssues.openedWeek, weeks[weeks.length - 1]),
          or(isNull(performanceIssues.resolvedWeek), gt(performanceIssues.resolvedWeek, weeks[0])),
          // The same flag every other open-work count reads, so the line
          // and the numbers beside it agree on what counts.
          OPENS_ACTION_ITEMS,
        ),
      ),
  ]);

  // KPI display names, in the order the ledger returned them; the view sorts.
  const kpiNames = new Map<string, string>();
  for (const row of rows) kpiNames.set(row.kpiCode, row.kpiName);

  const build = (ids: Set<string>): OrgTrendSeries[] => {
    const mine = rows.filter((r) => ids.has(r.employeeId));
    const myIssues = issues.filter((i) => ids.has(i.employeeId));

    const passRate: OrgTrendPoint[] = [];
    const mboPass: OrgTrendPoint[] = [];
    const openItems: OrgTrendPoint[] = [];
    const perKpi = new Map<string, OrgTrendPoint[]>();

    for (const week of weeks) {
      const wk = mine.filter((r) => r.weekStart === week);

      // Someone is failing the week if any one of their KPIs failed, so this
      // counts people rather than results.
      const evaluated = new Set(wk.map((r) => r.employeeId));
      const failingPeople = new Set(wk.filter((r) => r.status === "fail").map((r) => r.employeeId));
      if (evaluated.size > 0) {
        const met = evaluated.size - failingPeople.size;
        passRate.push({
          weekStart: week,
          value: (met / evaluated.size) * 100,
          caption: `${met} of ${evaluated.size} evaluated`,
        });
      }

      // MBO is a share of gates met, so clearing every gate is exactly 100.
      const mbo = wk.filter((r) => r.kpiCode === "MBO");
      if (mbo.length > 0) {
        const passing = mbo.filter((r) => r.actualValue >= 100).length;
        mboPass.push({
          weekStart: week,
          value: (passing / mbo.length) * 100,
          caption: `${passing} of ${mbo.length} scored`,
        });
      }

      const open = myIssues.filter(
        (i) => i.openedWeek <= week && (i.resolvedWeek === null || i.resolvedWeek > week),
      ).length;
      openItems.push({ weekStart: week, value: open, caption: `${open} open at week end` });

      for (const [code] of kpiNames) {
        const forKpi = wk.filter((r) => r.kpiCode === code);
        if (forKpi.length === 0) continue;
        const met = forKpi.filter((r) => r.status !== "fail").length;
        const points = perKpi.get(code) ?? [];
        points.push({
          weekStart: week,
          value: (met / forKpi.length) * 100,
          caption: `${met} of ${forKpi.length} weekly results`,
        });
        perKpi.set(code, points);
      }
    }

    const series: OrgTrendSeries[] = [
      {
        key: "PASS_RATE",
        label: "Meeting every KPI",
        note: "share of agents meeting every KPI they were scored on",
        target: null,
        unit: "percent",
        points: passRate,
      },
      {
        key: "MBO_PASS",
        label: "MBO pass rate",
        note: "share clearing every gate · target 90.0%",
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
      ...[...perKpi.entries()].map(([code, points]) => ({
        key: `KPI_${code}`,
        label: `${kpiNames.get(code) ?? code} achieved`,
        note: `share of weekly ${kpiNames.get(code) ?? code} results meeting target`,
        target: null,
        unit: "percent" as const,
        points,
      })),
    ];

    return series.filter((s) => s.points.length > 0);
  };

  const bySupervisor: Record<string, OrgTrendSeries[]> = {};
  for (const name of new Set(roster.map((r) => r.supervisorName).filter((n): n is string => Boolean(n)))) {
    const ids = new Set(roster.filter((r) => r.supervisorName === name).map((r) => r.employeeId));
    bySupervisor[name] = build(ids);
  }

  return { whole: build(new Set(employeeIds)), bySupervisor };
}

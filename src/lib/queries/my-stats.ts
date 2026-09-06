import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employees, kpiDefinitions, metricFacts, npsFacts } from "@/lib/db/schema";
import type { NpsMix } from "@/lib/kpi-engine/nps";
import { getPeriodMetrics } from "./period-metrics";
import { periodContaining, previousPeriod, type Period } from "./period";

export interface KpiComparison {
  kpiCode: string;
  kpiName: string;
  target: number | null;
  current: number | null;
  previous: number | null;
  /** Signed change, in the metric's own units. Null when either side is absent. */
  delta: number | null;
  /**
   * True when `delta` is movement in the good direction. Not simply
   * `delta > 0`: for AHT and critical errors, lower is better.
   */
  improved: boolean | null;
  status: string | null;
  sampleSize: number;
}

/** The month containing `date`, and the month before it. */
export function monthPair(date: string): { current: Period; previous: Period } {
  const current = periodContaining("month", date);
  const start = new Date(`${current.start}T00:00:00Z`);
  start.setUTCDate(0); // last day of the previous month
  return { current, previous: periodContaining("month", start.toISOString().slice(0, 10)) };
}

/**
 * Whether a change is an improvement, from the KPI's own configured
 * direction.
 *
 * This was previously a hardcoded list, which had DPU and DPO the wrong way
 * round: both are "share of audits with no markdown", so higher is better,
 * and a genuine improvement was being shown in red. Reading the definition
 * means the answer cannot drift from the scoring rules again.
 */
export function isImprovement(delta: number, direction: string): boolean | null {
  if (delta === 0) return null;
  if (direction === "lower_is_better") return delta < 0;
  if (direction === "higher_is_better") return delta > 0;
  return null;
}

/**
 * One employee's KPIs for the month to date, beside the same KPIs for the
 * previous month.
 *
 * Both sides re-aggregate from daily facts rather than averaging weekly
 * values, so a partial current month is compared on its own terms instead
 * of being scaled against a full one.
 */
export async function getMonthComparison(
  employeeId: string,
  date: string,
): Promise<{ period: Period; previous: Period; rows: KpiComparison[] }> {
  const { current, previous } = monthPair(date);

  const [currentMetrics, previousMetrics] = await Promise.all([
    getPeriodMetrics([employeeId], current),
    getPeriodMetrics([employeeId], previous),
  ]);

  const before = new Map(previousMetrics.map((m) => [m.kpiCode, m]));
  const rows: KpiComparison[] = currentMetrics.map((m) => {
    const prior = before.get(m.kpiCode);
    const delta = prior ? m.actualValue - prior.actualValue : null;

    return {
      kpiCode: m.kpiCode,
      kpiName: m.kpiName,
      target: m.targetValue,
      current: m.actualValue,
      previous: prior?.actualValue ?? null,
      delta,
      improved: delta === null ? null : isImprovement(delta, m.direction),
      status: m.status,
      sampleSize: m.sampleSize,
    };
  });

  // A KPI measured last month but not this one still belongs in the table —
  // its absence is itself the story.
  for (const prior of previousMetrics) {
    if (rows.some((r) => r.kpiCode === prior.kpiCode)) continue;
    rows.push({
      kpiCode: prior.kpiCode,
      kpiName: prior.kpiName,
      target: prior.targetValue,
      current: null,
      previous: prior.actualValue,
      delta: null,
      improved: null,
      status: null,
      sampleSize: 0,
    });
  }

  return { period: current, previous, rows };
}

export interface NpsBreakdown extends NpsMix {
  /** Responses counted in the score but missing from the promoter/passive/detractor split. */
  unclassified: number;
  /** Responses recorded for the period, from the score's own fact rows. */
  responses: number;
  /** Promoters less detractors, from the score — exact even without the split. */
  netPromoters: number | null;
}

/**
 * The NPS response mix for one employee over a period.
 *
 * The split comes from `nps_facts`, which is only populated by imports run
 * after that table existed. The score's own facts still carry the response
 * count and the net (promoters less detractors) for every period, so the
 * score and the promoters-needed figure stay exact even where the split is
 * missing — `unclassified` says how much of the period lacks it.
 */
export async function getNpsBreakdown(
  employeeId: string,
  period: Period,
): Promise<NpsBreakdown> {
  const [[mix], [totals]] = await Promise.all([
    db
      .select({
        promoters: sql<number>`coalesce(sum(${npsFacts.promoters}), 0)::int`,
        passives: sql<number>`coalesce(sum(${npsFacts.passives}), 0)::int`,
        detractors: sql<number>`coalesce(sum(${npsFacts.detractors}), 0)::int`,
      })
      .from(npsFacts)
      .where(
        and(
          eq(npsFacts.employeeId, employeeId),
          gte(npsFacts.factDate, period.start),
          lte(npsFacts.factDate, period.end),
        ),
      ),
    db
      .select({
        responses: sql<number>`coalesce(sum(${metricFacts.sampleSize}), 0)::int`,
        // Each survey is encoded 100 / 0 / -100, so the summed numerator over
        // 100 is exactly (promoters - detractors).
        net: sql<number | null>`sum(${metricFacts.numerator}) / 100.0`,
      })
      .from(metricFacts)
      .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, metricFacts.kpiId))
      .where(
        and(
          eq(metricFacts.employeeId, employeeId),
          eq(kpiDefinitions.code, "NPS"),
          gte(metricFacts.factDate, period.start),
          lte(metricFacts.factDate, period.end),
        ),
      ),
  ]);

  const classified = mix.promoters + mix.passives + mix.detractors;
  return {
    ...mix,
    responses: totals?.responses ?? 0,
    unclassified: Math.max(0, (totals?.responses ?? 0) - classified),
    netPromoters: totals?.net === null || totals?.net === undefined ? null : Number(totals.net),
  };
}

/** The employee record behind a signed-in account, or null when unlinked. */
export async function getOwnEmployee(employeeEid: string | null) {
  if (!employeeEid) return null;
  const [row] = await db
    .select({
      id: employees.id,
      eid: employees.eid,
      name: employees.name,
      site: employees.site,
      skillType: employees.skillType,
      supervisorName: employees.supervisorName,
      managerName: employees.managerName,
    })
    .from(employees)
    .where(eq(employees.eid, employeeEid))
    .limit(1);
  return row ?? null;
}

/** Skill targets, so the productivity calculator can score against the right one. */
export async function getSkillTargets(codes: string[]) {
  if (codes.length === 0) return [];
  return db
    .select()
    .from(kpiDefinitions)
    .where(inArray(kpiDefinitions.code, codes));
}

export interface TeamKpiCell {
  current: number | null;
  previous: number | null;
  delta: number | null;
  improved: boolean | null;
  status: string | null;
}

export interface TeamPeriodRow {
  employeeId: string;
  eid: string;
  name: string;
  /** Keyed by KPI code; absent when that KPI had no data either month. */
  cells: Record<string, TeamKpiCell>;
  /** How many KPIs are failing this month — the row's sort key. */
  failing: number;
}

export interface TeamPeriodComparison {
  period: Period;
  previous: Period;
  /** Only the KPIs that actually have data, so the table has no dead columns. */
  kpis: Array<{ code: string; name: string }>;
  rows: TeamPeriodRow[];
}

/**
 * KPIs for a whole team over any period, beside the period before it.
 *
 * Takes the period rather than a date so it follows whatever the picker is
 * set to — a day against the previous day, a quarter against the previous
 * quarter. Comparing a chosen week against "last month" would silently answer
 * a different question from the one asked.
 *
 * Two period queries rather than one per employee: the roll-up is done in
 * memory, so a 300-person span costs the same two round trips as one person.
 * Columns are derived from the data rather than from the KPI catalogue, so a
 * team that never records NPS does not carry an empty NPS column.
 */
export async function getTeamPeriodComparison(
  employeeIds: string[],
  current: Period,
): Promise<TeamPeriodComparison> {
  const previous = previousPeriod(current);
  if (employeeIds.length === 0) {
    return { period: current, previous, kpis: [], rows: [] };
  }

  const [currentMetrics, previousMetrics, roster] = await Promise.all([
    getPeriodMetrics(employeeIds, current),
    getPeriodMetrics(employeeIds, previous),
    db
      .select({ id: employees.id, eid: employees.eid, name: employees.name })
      .from(employees)
      .where(inArray(employees.id, employeeIds)),
  ]);

  const priorByKey = new Map(previousMetrics.map((m) => [`${m.employeeId}|${m.kpiCode}`, m]));
  const kpiNames = new Map<string, string>();
  const cellsByEmployee = new Map<string, Record<string, TeamKpiCell>>();

  for (const m of currentMetrics) {
    kpiNames.set(m.kpiCode, m.kpiName);
    const prior = priorByKey.get(`${m.employeeId}|${m.kpiCode}`);
    const delta = prior ? m.actualValue - prior.actualValue : null;

    const cells = cellsByEmployee.get(m.employeeId) ?? {};
    cells[m.kpiCode] = {
      current: m.actualValue,
      previous: prior?.actualValue ?? null,
      delta,
      improved: delta === null ? null : isImprovement(delta, m.direction),
      status: m.status,
    };
    cellsByEmployee.set(m.employeeId, cells);
  }

  // A KPI measured last month but not this one still earns a column; the
  // gap is what a supervisor needs to notice.
  for (const m of previousMetrics) {
    kpiNames.set(m.kpiCode, m.kpiName);
    const cells = cellsByEmployee.get(m.employeeId) ?? {};
    if (!cells[m.kpiCode]) {
      cells[m.kpiCode] = {
        current: null,
        previous: m.actualValue,
        delta: null,
        improved: null,
        status: null,
      };
      cellsByEmployee.set(m.employeeId, cells);
    }
  }

  const rows: TeamPeriodRow[] = roster
    .map((r) => {
      const cells = cellsByEmployee.get(r.id) ?? {};
      return {
        employeeId: r.id,
        eid: r.eid,
        name: r.name,
        cells,
        failing: Object.values(cells).filter((c) => c.status === "FAIL").length,
      };
    })
    // Most failures first: the table exists to be worked down.
    .sort((a, b) => b.failing - a.failing || a.name.localeCompare(b.name));

  return {
    period: current,
    previous,
    kpis: [...kpiNames.entries()].map(([code, name]) => ({ code, name })),
    rows,
  };
}

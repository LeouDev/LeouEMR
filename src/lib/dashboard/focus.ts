/**
 * "Focus Tech": the handful of agents furthest from target this period, for
 * the team leader's summary column. Ranked by how many KPIs are below
 * target, then how many are at risk, then how far the worst one is off —
 * so an agent missing three measures outranks one missing a single
 * measure by a mile, and two agents missing the same count are separated
 * by the size of the miss.
 */

export interface FocusMetric {
  employeeId: string;
  kpiCode: string;
  kpiName: string;
  direction: "higher_is_better" | "lower_is_better" | "range" | "boolean_match";
  actualValue: number;
  targetValue: number | null;
  status: string;
}

export interface FocusAgent {
  employeeId: string;
  eid: string;
  name: string;
  /** KPIs below target this period. */
  below: number;
  /** KPIs at risk (warning) this period. */
  atRisk: number;
  /** The measure furthest off target, to say what to look at first. */
  worst: { code: string; name: string; actual: number; target: number | null } | null;
}

export const FOCUS_LIMIT = 5;

/** How far off target, as a share of the target, in the direction that is bad; 0 when it cannot be said. */
function gapOf(metric: FocusMetric): number {
  const target = metric.targetValue;
  if (target === null || target === 0) return 0;
  if (metric.direction === "higher_is_better") return Math.max(0, (target - metric.actualValue) / Math.abs(target));
  if (metric.direction === "lower_is_better") return Math.max(0, (metric.actualValue - target) / Math.abs(target));
  return 0;
}

export function focusAgents(
  metrics: readonly FocusMetric[],
  people: ReadonlyMap<string, { name: string; eid: string }>,
  limit = FOCUS_LIMIT,
): FocusAgent[] {
  const byAgent = new Map<string, FocusAgent & { gap: number }>();
  for (const metric of metrics) {
    const status = metric.status.toUpperCase();
    if (status !== "FAIL" && status !== "WARNING") continue;
    const person = people.get(metric.employeeId);
    if (!person) continue;
    const entry = byAgent.get(metric.employeeId) ?? {
      employeeId: metric.employeeId,
      eid: person.eid,
      name: person.name,
      below: 0,
      atRisk: 0,
      worst: null,
      gap: -1,
    };
    if (status === "FAIL") entry.below += 1;
    else entry.atRisk += 1;
    // The worst measure is a failing one when there is any; among those, the
    // largest relative miss. A warning only stands in while nothing fails.
    const gap = status === "FAIL" ? 1 + gapOf(metric) : gapOf(metric);
    if (gap > entry.gap) {
      entry.gap = gap;
      entry.worst = { code: metric.kpiCode, name: metric.kpiName, actual: metric.actualValue, target: metric.targetValue };
    }
    byAgent.set(metric.employeeId, entry);
  }
  return [...byAgent.values()]
    .sort((a, b) => b.below - a.below || b.atRisk - a.atRisk || b.gap - a.gap || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => ({
      employeeId: entry.employeeId,
      eid: entry.eid,
      name: entry.name,
      below: entry.below,
      atRisk: entry.atRisk,
      worst: entry.worst,
    }));
}

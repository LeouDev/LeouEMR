import type { PeriodMetric } from "./period-metrics";

/**
 * A team's own figure per KPI for the supervisor's dashboard: what the
 * scored agents came to, how many of them were below target, and the
 * mean target they were held to.
 *
 * Every KPI but one is the mean of the agents scored on it — a quality
 * score or a production rate is a property of a person, and averaging
 * people is the right read of a team. NPS is not: it is defined over
 * responses, promoters less detractors over everyone who answered, so the
 * team's score is its members' scores weighted by how many surveys each
 * one got. The manager's overview and the Team page already pool it that
 * way (supervisor-kpis.ts); this card used to average members, so a team
 * lead and their manager read two different numbers for the same team,
 * and a member with one survey (+100 or -100) swung the lead's figure.
 */
export interface TeamKpi {
  code: string;
  name: string;
  /** The team's figure: the mean of the scored agents, or for NPS every survey pooled. */
  avg: number;
  /** Mean target across the scored agents; targets differ, a ramping agent's are lower. */
  target: number | null;
  below: number;
  scored: number;
  /** NPS only: the surveys behind the figure, its real sample. */
  surveys: number | null;
}

/** Sample size is the survey count on an NPS row; a row somehow without one still counts for one. */
function surveysOf(metric: PeriodMetric): number {
  return metric.sampleSize > 0 ? metric.sampleSize : 1;
}

export function teamKpiFigures(metrics: readonly PeriodMetric[]): TeamKpi[] {
  const acc = new Map<
    string,
    { code: string; name: string; sum: number; weight: number; targetSum: number; targets: number; below: number; scored: number; surveys: number | null }
  >();
  for (const m of metrics) {
    const pooled = m.kpiCode === "NPS";
    const entry = acc.get(m.kpiCode) ?? {
      code: m.kpiCode,
      name: m.kpiName,
      sum: 0,
      weight: 0,
      targetSum: 0,
      targets: 0,
      below: 0,
      scored: 0,
      surveys: pooled ? 0 : null,
    };
    const w = pooled ? surveysOf(m) : 1;
    entry.sum += m.actualValue * w;
    entry.weight += w;
    entry.scored += 1;
    if (pooled) entry.surveys = (entry.surveys ?? 0) + w;
    if (m.status === "FAIL") entry.below += 1;
    if (m.targetValue !== null) {
      entry.targetSum += m.targetValue;
      entry.targets += 1;
    }
    acc.set(m.kpiCode, entry);
  }
  return [...acc.values()].map((e) => ({
    code: e.code,
    name: e.name,
    avg: e.sum / e.weight,
    target: e.targets > 0 ? e.targetSum / e.targets : null,
    below: e.below,
    scored: e.scored,
    surveys: e.surveys,
  }));
}

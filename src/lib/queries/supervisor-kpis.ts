import { MBO_GATES } from "@/lib/import-pipeline/par-scoring";
import type { PeriodMetric } from "./period-metrics";
import { meanPresent } from "./stack-rank";

/**
 * Production, quality and NPS for each supervisor's team over one period —
 * the three columns the manager's overview carries beside MBO pass.
 *
 * Production is reported as a pass rate and the other two as levels, because
 * that is what each one is. Production has a gate the business either clears
 * or does not, and it is deliberately the same 2.99 that MBO itself uses
 * (MBO_GATES), so a row's prod pass rate can never disagree with its MBO pass
 * rate about the same person. Quality and NPS have no such gate in daily use:
 * a team at 96% quality against a 98% target is a different conversation from
 * one at 70%, and a pass rate would flatten both to "failing".
 *
 * A level is the mean over the members who actually have one, never over the
 * whole team — the same rule the stack rank follows (meanPresent). A team
 * with thin data reads on how its measured members did rather than being
 * pushed down for the members nobody measured, and the count travels beside
 * the figure so the thinness is visible instead of hidden.
 */
export interface SupervisorKpis {
  /** Share of the scored team clearing the production gate; null with nobody scored. */
  prodPassRate: number | null;
  prodPassing: number;
  prodScored: number;
  /** Mean quality across the members who have one; null when none do. */
  quality: number | null;
  qualityScored: number;
  /** The target in force for the members counted, for the row's own tone. */
  qualityTarget: number | null;
  nps: number | null;
  npsScored: number;
  npsTarget: number | null;
}

export const NO_SUPERVISOR_KPIS: SupervisorKpis = {
  prodPassRate: null,
  prodPassing: 0,
  prodScored: 0,
  quality: null,
  qualityScored: 0,
  qualityTarget: null,
  nps: null,
  npsScored: 0,
  npsTarget: null,
};

interface Team {
  prod: number[];
  quality: number[];
  qualityTargets: number[];
  nps: number[];
  npsTargets: number[];
}

/**
 * The target to judge a team's level against.
 *
 * Quality and NPS are configured org-wide, so every member normally carries
 * the same snapshotted target and this is that number. Where they differ —
 * a period spanning a target change — the strictest one is taken, so a row
 * goes quiet only when the team clears the bar under either rule.
 */
function strictestTarget(targets: number[]): number | null {
  return targets.length ? Math.max(...targets) : null;
}

/**
 * Rolls one period's KPI results up to the supervisors who owned the people.
 *
 * Employees with no supervisor in the roster are left out rather than pooled
 * under a heading nobody manages — the table's rows are supervisors.
 */
export function rollUpSupervisorKpis(
  metrics: PeriodMetric[],
  supervisorByEmployee: Record<string, string | null>,
): Map<string, SupervisorKpis> {
  const teams = new Map<string, Team>();
  const teamOf = (name: string): Team => {
    const existing = teams.get(name);
    if (existing) return existing;
    const fresh: Team = { prod: [], quality: [], qualityTargets: [], nps: [], npsTargets: [] };
    teams.set(name, fresh);
    return fresh;
  };

  for (const metric of metrics) {
    // A skill's own result is a work item, not one of these three KPIs, and
    // carries its own code — but the guard is explicit so a future skill
    // code that happens to collide cannot quietly join a team's average.
    if (metric.skillReferenceId !== null) continue;
    const supervisor = supervisorByEmployee[metric.employeeId];
    if (!supervisor) continue;
    const team = teamOf(supervisor);
    if (metric.kpiCode === "PRODUCTION_RATE") {
      team.prod.push(metric.actualValue);
    } else if (metric.kpiCode === "QUALITY") {
      team.quality.push(metric.actualValue);
      if (metric.targetValue !== null) team.qualityTargets.push(metric.targetValue);
    } else if (metric.kpiCode === "NPS") {
      team.nps.push(metric.actualValue);
      if (metric.targetValue !== null) team.npsTargets.push(metric.targetValue);
    }
  }

  const out = new Map<string, SupervisorKpis>();
  for (const [name, team] of teams) {
    const prodPassing = team.prod.filter((rate) => rate >= MBO_GATES.productionRate).length;
    out.set(name, {
      prodPassRate: team.prod.length > 0 ? (prodPassing / team.prod.length) * 100 : null,
      prodPassing,
      prodScored: team.prod.length,
      quality: meanPresent(team.quality),
      qualityScored: team.quality.length,
      qualityTarget: strictestTarget(team.qualityTargets),
      nps: meanPresent(team.nps),
      npsScored: team.nps.length,
      npsTarget: strictestTarget(team.npsTargets),
    });
  }
  return out;
}

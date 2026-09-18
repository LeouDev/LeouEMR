import { MBO_GATES } from "@/lib/import-pipeline/par-scoring";
import type { PeriodMetric } from "./period-metrics";
import { meanPresent } from "./stack-rank";

/**
 * Production, quality and NPS for each supervisor's team over one period —
 * the three columns the manager's overview carries beside MBO pass.
 *
 * Each one is reported the way that measure is actually defined, which is
 * three different shapes:
 *
 * **Production** is a pass rate, because it has a gate the business either
 * clears or does not, and it is deliberately the same 2.99 that MBO itself
 * uses (MBO_GATES), so a row's prod pass rate can never disagree with its
 * MBO pass rate about the same person. Quality and NPS have no such gate in
 * daily use: a team at 96% quality against a 98% target is a different
 * conversation from one at 70%, and a pass rate would flatten both to
 * "failing".
 *
 * **Quality** is the mean over the members who actually have a score, never
 * over the whole team — the same rule the stack rank follows (meanPresent).
 * A team with thin data reads on how its measured members did rather than
 * being pushed down for the members nobody measured, and the count travels
 * beside the figure so the thinness is visible instead of hidden. Averaging
 * members is right here because a quality score is a property of a person.
 *
 * **NPS is not an average of members.** NPS is defined over responses —
 * promoters less detractors, over everyone who answered — so the team's
 * score is its members' scores weighted by how many surveys each one got.
 * This was a mean of member scores until it was caught against the source
 * data: one team read 71 on sixteen members whose surveys, pooled, came to
 * 67.9. Twenty-eight surveys spread over sixteen people means most of them
 * had one, and a single survey reads as 100 or -100 — so the mean let the
 * lightest-sampled members swing a whole team's figure, and pushed it over
 * a target of 70 that the team had in fact missed.
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
  /** The team's NPS across all its surveys; null with none. */
  nps: number | null;
  /** Surveys behind that score — the figure's real sample. */
  npsSurveys: number;
  /** Members who had at least one survey, so thin coverage stays visible. */
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
  npsSurveys: 0,
  npsScored: 0,
  npsTarget: null,
};

interface Team {
  prod: number[];
  quality: number[];
  qualityTargets: number[];
  /** Promoters less detractors across the team, in the source's 100/0/-100 units. */
  npsNet: number;
  npsSurveys: number;
  npsScored: number;
  npsTargets: number[];
}

/**
 * The target to judge a team's level against.
 *
 * Quality and NPS are configured org-wide, so every member normally carries
 * the same snapshotted target and this is that number. Where they differ —
 * a period spanning a target change — the strictest one is taken, so a row
 * goes quiet only when the team clears the bar under BOTH rules. Erring
 * that way is deliberate: a team called out against the harder of two
 * targets is a conversation, and one waved through against the easier one
 * is a miss nobody sees.
 */
function strictestTarget(targets: number[]): number | null {
  return targets.length ? Math.max(...targets) : null;
}

/**
 * The team's NPS: every survey the team received, pooled.
 *
 * A member's own score is their summed survey values over their survey
 * count, so multiplying it back by that count recovers what those surveys
 * summed to and the pooled score is exact — the same arithmetic the
 * database does directly as `sum(numerator) / sum(sample_size)`.
 *
 * Rounded to six places before it leaves, because the multiply-back lands a
 * whisker under a whole number where the division landed exactly on one,
 * and both displays truncate rather than round: without this a team at a
 * true 68 can print 67.
 */
function pooledNps(team: Team): number | null {
  if (team.npsSurveys === 0) return null;
  return Math.round((team.npsNet / team.npsSurveys) * 1e6) / 1e6;
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
    const fresh: Team = {
      prod: [],
      quality: [],
      qualityTargets: [],
      npsNet: 0,
      npsSurveys: 0,
      npsScored: 0,
      npsTargets: [],
    };
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
      // Every NPS fact is written one survey at a time, so a sample size is
      // always there in practice. A row that somehow carries none still
      // counts for one rather than being weighted to nothing: a member
      // dropped out of their own team's score is worse than a member
      // weighted a little light.
      const surveys = metric.sampleSize > 0 ? metric.sampleSize : 1;
      team.npsNet += metric.actualValue * surveys;
      team.npsSurveys += surveys;
      team.npsScored += 1;
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
      nps: pooledNps(team),
      npsSurveys: team.npsSurveys,
      npsScored: team.npsScored,
      npsTarget: strictestTarget(team.npsTargets),
    });
  }
  return out;
}

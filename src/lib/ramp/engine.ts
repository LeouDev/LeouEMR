/**
 * New-hire ramp: pure date arithmetic behind "which week of ramp is this
 * employee in, and what does that mean for their target."
 *
 * The schedule itself (stage -> target, per skill) is configuration in
 * skill_ramp_schedules; this module only ever answers "which stage does this
 * calendar week fall on," given when an employee's ramp began. Kept free of
 * the database and of any specific skill so the one place that could get an
 * off-by-one wrong — the boundary where ramp ends and the steady target
 * resumes — is fully covered by tests rather than exercised only through a
 * live import.
 */

import { periodContaining } from "@/lib/queries/period";

/**
 * Stages 0 and 1 are the two nesting weeks; 2 through LAST_STAGE are ramp
 * Week 1 through Week 8. Ten reporting weeks in all — the business's
 * onboarding path — then the skill's steady target applies.
 */
export const NESTING_STAGES = 2;
export const LAST_STAGE = 9;

export function isNesting(stage: number): boolean {
  return stage >= 0 && stage < NESTING_STAGES;
}

/** "Nesting 1", "Nesting 2", "Week 1", … "Week 8". */
export function stageLabel(stage: number): string {
  return isNesting(stage) ? `Nesting ${stage + 1}` : `Week ${stage - NESTING_STAGES + 1}`;
}

/** `YYYY-MM-DD` shifted by whole days, in UTC so it never drifts by timezone. */
function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The reporting week `stages` weeks after the one containing `rampStartWeek`.
 *
 * Walked week by week through `periodContaining` rather than added as
 * `stages * 7` days, so a ramp that spans the Sunday cut-over (period.ts)
 * keeps to the reporting weeks the ledger is keyed by — the extended
 * eight-day week just before it would otherwise put every later stage one
 * day off its week.
 */
function weekAfter(rampStartWeek: string, stages: number): { start: string; end: string } {
  let week = periodContaining("week", rampStartWeek);
  for (let i = 0; i < stages; i++) week = periodContaining("week", shiftDay(week.end, 1));
  return week;
}

/**
 * Which ramp stage a reporting week falls on, given when ramp began.
 *
 * Null before ramp starts (the assignment does not apply yet — a week
 * imported before a new hire's actual start should never be discounted) and
 * null once it is over (past ramp Week 8, ramp is complete and the caller should
 * fall back to the skill's own steady-state target, the same as it would for
 * anyone with no ramp assignment at all).
 *
 * Any day within a week names that week, so an as-of date and a stored
 * week start resolve alike.
 */
export function rampStageForWeek(rampStartWeek: string, evaluatedWeekStart: string): number | null {
  const evaluated = periodContaining("week", evaluatedWeekStart).start;
  let week = periodContaining("week", rampStartWeek);
  if (evaluated < week.start) return null;

  for (let stage = 0; stage <= LAST_STAGE; stage++) {
    if (week.start === evaluated) return stage;
    week = periodContaining("week", shiftDay(week.end, 1));
  }
  return null;
}

/** The reporting week (its first day) a given stage falls on, for a ramp starting `rampStartWeek`. */
export function weekForStage(rampStartWeek: string, stage: number): string {
  return weekAfter(rampStartWeek, stage).start;
}

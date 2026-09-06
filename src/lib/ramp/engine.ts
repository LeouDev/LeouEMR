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

/** Stage 0 is Nesting; 1 through LAST_STAGE are Week 1 through Week 8. */
export const LAST_STAGE = 8;

/** "Nesting", "Week 1", … "Week 8". */
export function stageLabel(stage: number): string {
  return stage === 0 ? "Nesting" : `Week ${stage}`;
}

/** `YYYY-MM-DD` shifted by whole days, in UTC so it never drifts by timezone. */
function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Which ramp stage a reporting week falls on, given when ramp began.
 *
 * Null before ramp starts (the assignment does not apply yet — a week
 * imported before a new hire's actual start should never be discounted) and
 * null once it is over (past week 8, ramp is complete and the caller should
 * fall back to the skill's own steady-state target, the same as it would for
 * anyone with no ramp assignment at all).
 */
export function rampStageForWeek(rampStartWeek: string, evaluatedWeekStart: string): number | null {
  const start = new Date(`${rampStartWeek}T00:00:00Z`).getTime();
  const evaluated = new Date(`${evaluatedWeekStart}T00:00:00Z`).getTime();
  const diffDays = Math.round((evaluated - start) / 86_400_000);
  if (diffDays < 0) return null;

  const stage = Math.floor(diffDays / 7);
  return stage > LAST_STAGE ? null : stage;
}

/** The reporting week (Saturday) a given stage falls on, for a ramp starting `rampStartWeek`. */
export function weekForStage(rampStartWeek: string, stage: number): string {
  return shiftDay(rampStartWeek, stage * 7);
}

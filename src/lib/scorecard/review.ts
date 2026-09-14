/**
 * The scorecard's calendar rules, pure so they can be pinned: when a team
 * leader may review a month, which months the error counts span, and
 * whether a card has moved since it was reviewed.
 */

/** Days after the month ends before its scorecard can be reviewed — time for the month's data to land. */
export const REVIEW_GRACE_DAYS = 10;

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The first day of the month containing `date`. */
export function monthStartOf(date: string): string {
  const d = utc(date);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/** The last day of the month that starts on `monthStart`. */
export function monthEndOf(monthStart: string): string {
  const d = utc(monthStart);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** The day a month's scorecard opens for the team leader's review: ten days after the month ends. */
export function reviewOpensOn(monthStart: string): string {
  const end = utc(monthEndOf(monthStart));
  end.setUTCDate(end.getUTCDate() + REVIEW_GRACE_DAYS);
  return iso(end);
}

export function canReview(monthStart: string, today: string): boolean {
  return today >= reviewOpensOn(monthStart);
}

/**
 * The six calendar months ending with the card's month, inclusive: the
 * window Critical Errors and Standard Errors are counted over. September
 * counts April to September; October counts May to October.
 */
export function errorWindow(monthStart: string): { start: string; end: string } {
  const d = utc(monthStart);
  return {
    start: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 5, 1))),
    end: monthEndOf(monthStart),
  };
}

/**
 * Whether a reviewed card no longer says what the team leader signed off.
 * A re-import recomputes the numbers; the stamps stay, and the card says so
 * rather than freezing or being silently rewritten.
 */
export function changedSinceReview(reviewedScore: number | null, currentScore: number | null): boolean {
  if (reviewedScore === null && currentScore === null) return false;
  if (reviewedScore === null || currentScore === null) return true;
  return Math.abs(reviewedScore - currentScore) > 0.005;
}

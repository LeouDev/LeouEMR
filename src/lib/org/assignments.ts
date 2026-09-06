/**
 * Dated org-structure history.
 *
 * `employees` holds one current row per person, which answers "who reports to
 * me today" — the right basis for authorization and day-to-day work. It
 * cannot answer "whose team was this agent on in August", because it keeps no
 * history: a realignment silently rewrites the past, moving last month's
 * numbers to a supervisor who did not earn them.
 *
 * These are the pure interval operations behind the fix. They are deliberately
 * free of any database or date-of-day dependency so the awkward cases —
 * splitting an open interval, re-importing a month already imported, a person
 * moving twice inside one file — can be pinned down in tests rather than
 * discovered in production.
 *
 * Dates are inclusive `YYYY-MM-DD` strings throughout. A null `effectiveTo`
 * means "still current", matching the source data, which never states an end.
 */

/** The org fields the source workbook carries on every weekly row. */
export interface OrgTuple {
  supervisorEid: string | null;
  supervisorName: string | null;
  managerName: string | null;
  site: string | null;
}

export interface Assignment extends OrgTuple {
  effectiveFrom: string;
  /** Null means open-ended: this is the person's current assignment. */
  effectiveTo: string | null;
  /**
   * Which import established this interval. Provenance only — deliberately
   * ignored by `sameOrg`, so two imports stating the same structure still
   * merge into one interval rather than fragmenting the history.
   */
  sourceImportId?: string | null;
}

/** One week of org structure as read from the source file. */
export interface OrgWeek extends OrgTuple {
  weekStart: string;
  weekEnd: string;
}

export function sameOrg(a: OrgTuple, b: OrgTuple): boolean {
  return (
    a.supervisorEid === b.supervisorEid &&
    a.supervisorName === b.supervisorName &&
    a.managerName === b.managerName &&
    a.site === b.site
  );
}

/** `YYYY-MM-DD` shifted by whole days, in UTC so it never drifts by timezone. */
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True when `b` starts the day after `a` ends, or sooner. */
function abuts(a: Assignment, b: Assignment): boolean {
  if (a.effectiveTo === null) return true;
  return b.effectiveFrom <= shiftDay(a.effectiveTo, 1);
}

/**
 * Collapses per-week org readings into the fewest intervals that describe them.
 *
 * Consecutive weeks reporting the same structure become one interval, and a
 * gap in the weeks does not break one: a missing week means the file said
 * nothing that week, not that the person moved and moved back.
 */
export function collapseWeeks(weeks: OrgWeek[]): Assignment[] {
  const sorted = [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const out: Assignment[] = [];

  for (const week of sorted) {
    const last = out[out.length - 1];
    // A duplicate week (the same week appearing on two sheets) must not
    // rewind the interval's end.
    if (last && sameOrg(last, week)) {
      if (last.effectiveTo === null || week.weekEnd > last.effectiveTo) {
        last.effectiveTo = week.weekEnd;
      }
      continue;
    }
    out.push({
      effectiveFrom: week.weekStart,
      effectiveTo: week.weekEnd,
      supervisorEid: week.supervisorEid,
      supervisorName: week.supervisorName,
      managerName: week.managerName,
      site: week.site,
    });
  }

  // A person who moved mid-file leaves the previous interval ending on its own
  // last week; close any overlap so the intervals stay disjoint.
  for (let i = 0; i < out.length - 1; i += 1) {
    const current = out[i];
    const end = shiftDay(out[i + 1].effectiveFrom, -1);
    if (current.effectiveTo === null || current.effectiveTo > end) current.effectiveTo = end;
  }

  return out;
}

/**
 * Removes `[from, to]` from one interval, returning the 0–2 pieces that survive.
 *
 * An open-ended interval yields no right-hand piece. "Lea, from August, until
 * told otherwise" is not a claim about September — it is the absence of one.
 * Being told about September supersedes it rather than sitting inside it, so
 * the old claim must not reappear as a tail after the newer window.
 */
function subtract(a: Assignment, from: string, to: string): Assignment[] {
  const endsBefore = a.effectiveTo !== null && a.effectiveTo < from;
  const startsAfter = a.effectiveFrom > to;
  if (endsBefore || startsAfter) return [a];

  const pieces: Assignment[] = [];
  if (a.effectiveFrom < from) {
    pieces.push({ ...a, effectiveTo: shiftDay(from, -1) });
  }
  if (a.effectiveTo !== null && a.effectiveTo > to) {
    pieces.push({ ...a, effectiveFrom: shiftDay(to, 1), effectiveTo: a.effectiveTo });
  }
  return pieces;
}

/**
 * Replaces what is known about `[rangeStart, rangeEnd]` with `incoming`,
 * leaving everything outside that window untouched.
 *
 * This is what makes re-importing safe. An upload describes a specific span of
 * weeks and is authoritative for exactly that span — so the span is cut out of
 * the existing history and the new intervals dropped in, rather than the
 * history being appended to or wholesale replaced. Re-importing the same file
 * therefore lands on the same result, and importing an older month cannot
 * clobber a newer one.
 *
 * The newest interval always ends open, because the source never states an end
 * date and "the latest thing we were told" is exactly what `employees` holds.
 * The newest week of any import therefore sets the current assignment, which
 * is the same last-import-wins rule `employees` has always followed.
 */
export function spliceAssignments(
  existing: Assignment[],
  incoming: Assignment[],
  rangeStart: string,
  rangeEnd: string,
): Assignment[] {
  // An import that says nothing about this person is not evidence that their
  // history should be cut short.
  if (incoming.length === 0) return existing.map((a) => ({ ...a }));

  const kept = existing.flatMap((a) => subtract(a, rangeStart, rangeEnd));
  const all = [...kept, ...incoming].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  const merged: Assignment[] = [];
  for (const next of all) {
    const last = merged[merged.length - 1];
    if (last && sameOrg(last, next) && abuts(last, next)) {
      if (last.effectiveTo !== null) {
        last.effectiveTo =
          next.effectiveTo === null
            ? null
            : next.effectiveTo > last.effectiveTo
              ? next.effectiveTo
              : last.effectiveTo;
      }
      continue;
    }
    merged.push({ ...next });
  }

  if (merged.length > 0) merged[merged.length - 1].effectiveTo = null;
  return merged;
}

/** The assignment covering `date`, or null when the history says nothing. */
export function assignmentOn(assignments: Assignment[], date: string): Assignment | null {
  for (const a of assignments) {
    if (a.effectiveFrom <= date && (a.effectiveTo === null || a.effectiveTo >= date)) return a;
  }
  return null;
}

import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { LAST_LEGACY_WEEK_START, WEEK_CUTOVER } from "./period";

/**
 * The reporting week a date column falls in, as SQL — the same rule as
 * `weekContaining` in period.ts: Sunday-to-Saturday weeks from the
 * cut-over, the one extended eight-day week just before it, and the
 * legacy Saturday-to-Friday weeks before that. Queries that bucket daily
 * facts by week must use this rather than day-of-week arithmetic of their
 * own, or a week straddling the cut-over would be split two ways.
 *
 * Yields a `date`; cast to text where the row is read as a string.
 */
export function reportingWeekStart(column: AnyPgColumn | SQL): SQL {
  return sql`(case
    when ${column} >= ${WEEK_CUTOVER}::date then ${column} - extract(dow from ${column})::int
    when ${column} >= ${LAST_LEGACY_WEEK_START}::date then ${LAST_LEGACY_WEEK_START}::date
    else ${column} - ((extract(dow from ${column})::int + 1) % 7)
  end)`;
}

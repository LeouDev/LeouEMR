# Runbook: reporting weeks Sunday to Saturday from 31 May 2026

The operation runs a Sunday-to-Saturday week. Until this change the app
read the workbook's `WE <Friday>` labels as Saturday-to-Friday weeks
(which is the span those labels really cover — `scripts/sql/
week-boundary-check.sql` showed 4,791 of 4,792 weekly rows matching that
span). The owner decided on 17 Sep 2026 to re-cut the data on the
operation's week from **Sunday 31 May 2026** and leave everything before
it as reported.

## The rule (src/lib/queries/period.ts, src/lib/queries/week-sql.ts)

| Dates                       | Week                                   |
| --------------------------- | -------------------------------------- |
| up to 22 May 2026           | Saturday to Friday, as before          |
| 23 May – 30 May 2026        | one extended week, Sat 23 to Sat 30    |
| 31 May 2026 onward          | Sunday to Saturday                     |

The extended week exists so the grids meet with no gap and no one-day
week: under the old grid Sat 30 May began a week; under the new grid it
ends one. `weekContaining` (TypeScript) and `reportingWeekStart` (SQL)
are the only two places the rule lives; they are tested against each
other for every day of 2026.

What follows from it:

- **Import** (`src/lib/import-pipeline/week-placement.ts`): from 23 May
  2026 a row is placed by its own date column, not the `WE` label. The
  label's Saturday belongs to the previous reporting week. A row in
  that range with no readable date is placed in the week containing the
  label's Friday and counted in a warning on the import preview.
- **Ramp** (`src/lib/ramp/engine.ts`): stages walk reporting weeks, so a
  ramp that began before the cut-over stays on the grid. Start dates
  snap to the Sunday of their week.
- **Monthly PAR / scorecard**: the per-week volume split uses the SQL
  rule.
- Quality audit weeks were already Sunday to Saturday and are separate.

## Order of operations

The migration moves every stored week key from Sat 30 May 2026 on one
day forward, onto its Sunday, and extends the week of 23 May to end on
30 May. It does not touch daily facts. Re-importing the affected
workbooks then rebuilds the weekly figures on the new grid from those
facts.

1. **Before anything**, run section A of
   `scripts/sql/sunday-recut-check.sql` in the Supabase SQL editor and
   keep the output. A1 should show only Saturdays to move (`to_move`)
   and nothing under `already_sunday`. A4 lists the workbooks to
   re-import.
2. Paste `drizzle/APPLY_0055_SUNDAY_WEEKS.sql`. The verify row should
   read all zeros for `*_saturday_keys_left`, `ledger_bad_span 0`,
   `tracked 1`; `legacy_week_extended` is 1 if the week of 23 May was
   ever imported. Run it before the release is deployed: with the old
   code still live for those minutes the dashboard's "latest week" is
   one day off, which is harmless; the other order (deploy first, then
   an import, then the migration) would leave that week's Saturday rows
   beside its Sunday rows, which the migration refuses to overwrite and
   the verify row surfaces as a non-zero `ledger_saturday_keys_left`.
3. Merge and deploy the release.
4. **Re-import every workbook with rows dated 30 May 2026 or later,
   oldest first** — the list from A4. The file labelled `WE 06/05/26`
   carries the Saturday 30 May rows the extended week needs. Each
   re-import re-sums its weeks from the daily facts inside the new
   windows, re-evaluates the action-item engine for those weeks (a
   re-imported week whose result changed is reconciled, not re-opened)
   and re-splices the org history. Watch the preview for the "placed by
   their week label" warning: a count there means a sheet is missing
   its date column.
5. On the Ramp page press **Re-apply all ramps**, so each ramping agent's
   stored weekly targets follow the Sunday weeks.
6. Run section B of the check script. B1 all zeros (except
   `legacy_week_extended`); B2 `differs 0` for every re-imported week.

Weeks before 23 May 2026 are not re-imported and keep their
Saturday-to-Friday keys and figures.

## If a step is skipped

- Migration applied, files not yet re-imported: the ledger's weeks are
  keyed on Sundays but still hold Saturday-to-Friday sums. The dashboard
  is internally consistent (everything reads the same keys) but each
  week's figure is one day off until its file is re-imported.
- Files re-imported before the migration (on the new code): those weeks
  exist twice, under both keys. The migration leaves the Saturday rows
  alone; delete nothing — re-import the week again after the migration
  and the Sunday row is corrected, then ask before touching the stale
  Saturday rows.

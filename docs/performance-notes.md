# Performance and UX notes for future sessions

Working notes on how this app behaves under load and what has already been
fixed, so a later session does not rediscover or undo any of it. Kept in the
repository because the previous session's memory store was not reachable
from every environment this project gets worked on in.

## Architecture facts that shape every fix

- **Vercel region is `bom1` (Mumbai)**, per `vercel.json`. Supabase is a
  separate region, so every database round trip costs real latency. The
  single biggest lever on page speed is the *depth* of the fetch chain (how
  many dependent round trips run in sequence), not the cost of any one query.
- **The db client pool is `max: 8`** (`src/lib/db/client.ts`) against
  Supabase's transaction-mode pooler on port 6543, with `prepare: false`.
  Exceeding the pool with concurrent queries does not queue cleanly: it
  wedges a connection (seen live as `ClientRead` for 60s+ in
  `pg_stat_activity`). So: parallelize *shallow, small* fan-outs only, and
  never run two "heavy" callers (`getAnalytics`, `getMboOverview`,
  `getPeriodMetrics` with a big id list) concurrently with each other.
  `getPeriodMetrics` alone holds up to 3 connections at once; the Dashboard
  already runs two of them side by side. Do not widen its internal fan-out.
- **Server actions return refusals as values** (`{ ok: false, error }`).
  A *thrown* action only ever means infrastructure gave out (network,
  timeout, deploy rollover). Every client call site now catches that and
  shows `describeActionError()` (`src/lib/ui/action-error.ts`) instead of
  sitting on "Saving…" forever. Keep new forms on that pattern.
- **`(shell)/loading.tsx` always draws a navy page band.** Every page under
  the shell should open with `<PageBand>` so the skeleton has something to
  become; a page without one visibly jumps on arrival. Both detail pages
  (action item, employee) lacked one until this pass.

## Already fixed — verify, don't redo

Prior session (see git log around 0040):
- `getAnalytics` + `getMboOverview` must never run via `Promise.all` with
  each other (Analytics page and both Dashboard views fetch sequentially).
- Date-leading indexes on `metric_facts`, `skill_facts`,
  `weekly_metric_results` (migration 0040). The older composite indexes lead
  with `employee_id` and cannot serve a bare date-range scan.
- Admin dashboard defaults to a trailing 3-month window, "View all-time" is
  opt-in.
- Auth is verified once, in middleware, and passed as `x-user-id`;
  `getCurrentUser()` never calls `supabase.auth.getUser()` again.
- `eligibleForPeriod` no longer runs one query per separated employee.

This session (static audit — see "What could not be measured" below):
- **Import pipeline**: `reconcileFactBackedRows` read every `metric_facts`
  row ever recorded for the imported employees × KPIs, unbounded by date,
  on every weekly import. Now bounded to the min weekStart / max weekEnd of
  the rows being reconciled (`factWindow()` in `commit.ts`), which is the
  only span the JS ever looked at anyway.
- **Ramp "Start ramp" / "Clear"**: `applyAndReplay` did one UPDATE per
  already-imported week; now a single VALUES-join UPDATE.
- **Fetch chains flattened**: PTO page 6 dependent stages → 3; Employees
  page dropped a redundant `getLatestWeek()` (the distinct-weeks list is
  newest-first, so its head is the latest); Users page runs its two reads
  together; Stack Rank reads scope and roster together; the employee
  matrix folds the case-rate read into the history/notes batch; 201 File is
  one LEFT-joined read instead of two dependent ones.
- **UX**: every server-action call site survives a throw; the ramp Clear
  button no longer uses `alert()`; Employees distinguishes "no matches for
  these filters" from "your scope is empty (account not linked)"; MBO tab
  empty states read as sentences; Action Items names the filtered employee
  even when they have no items; both import wizards say a large import can
  take minutes and to keep the tab open.

## Known, deliberately left alone (measure before touching)

- `notifications` has no index on `(recipient_id, read_at)`; the header
  counts unread on every page. Fine while the table is small; add an index
  through a Drizzle migration once it is not.
- `audit_log` has no index on `created_at`; the admin Audit page sorts the
  whole table. Same advice.
- `getSkillMetricsBySupervisor` (Analytics) loads skill references after
  the facts rather than alongside them; one extra round trip on an
  admin-only page.
- `getActionItems` and friends resolve the scope's employee ids with a
  separate query and then `IN (...)` them. At ~450 employees this is fine;
  a join would save one round trip per page.

## What could not be measured in this session

This session had no database credentials, no Supabase MCP, no browser
tool, and no Vercel CLI, so nothing above carries a before/after timing.
Every change is a structural one that can be reasoned about statically
(fewer sequential round trips, a bounded read instead of an unbounded one,
one statement instead of N). The next session with `execute_sql` should:

1. `EXPLAIN ANALYZE` the bounded `metric_facts` read in
   `reconcileFactBackedRows` against a real import window and confirm it
   uses `metric_facts_date_employee_idx`.
2. Time the PTO, Employees, Stack Rank, and employee detail pages in
   production (server timing via `vercel logs`) before and after.
3. Check `pg_stat_activity` during a Stack Rank load for an admin — that
   page runs `getPeriodMetrics` over every employee.

## Local development gotchas

- `npm ci` fails behind a proxy that blocks `cdn.sheetjs.com` (the `xlsx`
  tarball). For local typecheck/lint/tests only, temporarily point `xlsx`
  at `0.18.5` from the npm registry, `npm install --no-package-lock`, then
  `git checkout package.json package-lock.json`. Never commit that change.
- `tsc --noEmit` needs `npx next typegen` first (route types), or it fails
  on `LayoutProps`. CI avoids this by running `next build` last.

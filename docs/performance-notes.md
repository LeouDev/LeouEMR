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
  postgres-js does not queue a query when every connection is busy — it
  pipelines it onto a busy connection (`busy.shift()` in its pool
  handler; only after 100 per connection does it queue), and the
  transaction pooler hangs a pipelined query forever (seen live as
  `ClientRead` for 60s+ in `pg_stat_activity`). Since 2026-09-11 the
  client is wrapped in `withQueryGate` (`src/lib/db/query-gate.ts`): at
  most 8 queries are ever dispatched at once, a transaction holds one
  slot for its whole duration, and everything beyond that waits for a
  free connection. A burst now queues for a few hundred milliseconds
  instead of hanging the request. Still worth respecting: the gate
  bounds concurrency, not database load — do not widen the heavy
  callers' internal fan-outs (`getPeriodMetrics` holds up to 3 slots).
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
- **Query gate on the db client (2026-09-11).** `withQueryGate` in
  `src/lib/db/query-gate.ts`, wired in `client.ts`; unit-tested against a
  fake postgres-js query, and checked live against a local Postgres 16
  (pool of 2, twelve concurrent queries plus a transaction: all correct,
  peak of 2 active sessions). See the incident below for why.

## Caching layer (src/lib/cache.ts)

- `cachedRead(name, tags, fn)` wraps a read in `unstable_cache` with a
  10-minute safety window; `invalidateCache(...tags)` evicts with
  `{ expire: 0 }` (no stale-while-revalidate: an admin who just imported
  expects the next page to show it). Three tags: `imports`, `reference`,
  `ramp`. Every writing server action evicts its tag (import, masterlist,
  ramp set/clear, skill target). Command-line scripts under `scripts/`
  cannot evict, hence the 10-minute window; a redeploy also clears all.
- Both helpers are pass-throughs when `process.env.NEXT_RUNTIME` is unset
  (tests, tsx scripts): `unstable_cache` and `revalidateTag` throw outside
  a Next request.
- Cached reads must return plain JSON: build Maps/Sets at the call site.
  Timestamps are excluded from cached rows for the same reason.
- `getPeriodMetrics(ids, period)` is now computed organisation-wide per
  period (compact tuple form, roughly 70 bytes per employee-KPI, so a
  month for ~660 people is well under Vercel's 2 MB per-entry limit) and
  filtered per caller. Cold computes are serialised per instance so two
  periods never aggregate concurrently against the pool. Also cached:
  skill configuration (one read behind loadSkillReferences /
  loadAttributesBySkill / loadSkillMetrics), ramp targets and schedules,
  KPI definitions, fact date range, available/latest weeks, and the
  per-period set of employees with reportable data.
- Analytics: `getAnalytics`, `getMboOverview`, `getSkillMetricsBySupervisor`
  and `getCriticalErrorsTrendBySupervisor` are cached per filter/period.
  Two extra tags for them: `ews` (evicted by saveEwsAssessment — separation
  dates decide who counts) and `issues` (evicted by sendToAgent,
  acknowledge, the import). Their cold computes run through the
  `serialized("analytics")` queue, which is what allows the Analytics page
  and the admin dashboard to request every snapshot at once: warm reads
  resolve in parallel, misses still compute one at a time. The queue's
  wait for a predecessor is bounded (`QUEUE_STALL_MS`, 30 s, with a
  console warning when it trips): the queue lives as long as the server
  instance, so an unbounded wait behind one computation that never
  finished would hang every later request on that instance. Keep the
  queue: the query gate stops a burst from wedging the pool, the queue
  stops two cold aggregations from doubling the database's load.
- Not cached on purpose: anything keyed on the current user, the EWS
  board itself, and the users row behind `getCurrentUser` (roles can be
  changed by a script; a stale role would be a security problem, not a
  performance one).

## Navigation feedback (src/components/navigation-progress.tsx)

- The shell layout renders a progress bar under the sticky header, driven
  by a context that any control can flip: nav tabs via `onNavigate`,
  `PeriodPicker` / `GranularitySelect` / `RosterFilters` via `navigate()`,
  link tab strips via `NavLink`. Cleared when the URL changes; a 20 s
  timeout guards a navigation that never lands.
- Why it matters here: main-nav prefetch is off (see nav-tabs.tsx and the
  middleware matcher), so nothing on screen changed between a click and
  the server's first byte — auth verification, any cold start and the first
  database round trips all happen inside that gap.

## The floor, explained (2026-09-10)

- The team reaches the app over Optum's corporate VPN, which exits in the
  United States: Vercel logs show requests "Received in Cleveland (cle1)".
  A click therefore travels Philippines → US → Mumbai (functions and
  database) and back, roughly 600 ms before any work. That is the whole
  650–700 ms floor measured on every page, light or heavy. No code change
  moves it. The only levers are split-tunnelling this one public domain
  past the VPN (an Optum IT decision) or migrating the database and
  functions to a US region next to the VPN exit.
- Statement timeouts ("canceling statement due to statement timeout",
  Sep 9 21:42 UTC) hit trivial queries during a burst of rapid clicks.
  They occurred on the pre-cache code (the caching deploy went live at
  23:08 UTC), when every click re-ran the period aggregates and the
  database saturated. No errors in the 24 hours after the deploys. The
  connection pool (`max: 8`) was deliberately not changed: the cause was
  load, not pool size. Note for the future: Fluid Compute is on, so one
  instance serves several requests at once and they share that pool —
  the client's own comment still assumes one request per instance.

## Incident: manager dashboard "Something went wrong" (2026-09-11)

- **Symptom.** A manager opening `/dashboard` got the shell error page
  with no `Reference:` line, or sat on the loading skeleton. Admin pages
  were fine. The browser console showed `Minified React error #412`,
  which is the React Flight client's "Connection closed." — the RSC
  stream ended before the page's data arrived. No server error was
  thrown, which is why there was no digest. Vercel's request log showed
  the real `/dashboard` navigations as middleware rows with status `---`
  (no response ever completed); the small 200s for `/dashboard?_rsc=` in
  the Network tab were prefetches of the header logo link, not the
  failing request.
- **Cause.** The render hung on a query pipelined past the pool (see the
  pool fact above). The manager dashboard is the widest fan-out in the
  app — its second batch alone is up to ten queries (summary, attention
  rows, supervisor rollup, overdue count, scope resolution), on top of
  the layout's own reads and, under Fluid Compute, whatever other
  requests share the instance — so it is the page that crosses eight.
- **Fix.** The query gate, the bounded queue wait, and `error.tsx` now
  naming a dropped connection instead of the generic message.
- **How to see a hang, next time.** A page whose request has no status
  in the Vercel log, a client error with no digest, and nothing in the
  function's own logs is a hang, not a crash. `pg_stat_activity` on the
  Supabase side (`state`, `wait_event`, `query_start`) says which
  statement, if any, is actually running.
- **Open question for the database owner.** The user ran
  `ALTER ROLE postgres SET statement_timeout = '60s'` by mistake and
  then `ALTER ROLE postgres RESET statement_timeout`. If Supabase had set
  a default for the `postgres` role, the reset removed it. The Sep 9
  "canceling statement due to statement timeout" errors prove some
  timeout existed then. Check with
  `select rolname, rolconfig from pg_roles where rolconfig is not null;`
  and, if the `postgres` role no longer carries one, decide whether to
  restore it. (A statement timeout would not have rescued this incident
  — a pipelined query is not a running statement — but it is the only
  thing that bounds a genuinely slow query.)

## Known, deliberately left alone (measure before touching)

- `notifications` has no index on `(recipient_id, read_at)`; the header
  counts unread on every page. Fine while the table is small; add an index
  through a Drizzle migration once it is not.
- `audit_log` has no index on `created_at`; the admin Audit page sorts the
  whole table. Same advice.
- `getSkillMetricsBySupervisor` (Analytics) loads skill references after
  the facts rather than alongside them; one extra round trip on an
  admin-only page.
- Regions are aligned: Supabase is `ap-south-1` and Vercel functions are
  pinned to `bom1` (both Mumbai), on the Vercel Hobby plan (one region,
  Fluid Compute on). Do not move the function region. Users are in the
  Philippines, so each request still carries ~100 ms of their own RTT.
- Middleware verifies sessions with `getClaims()` (the project signs with
  ECC P-256, so verification is local; the JWKS is cached ten minutes per
  instance), falling back to `getUser()` only if the key fetch fails. The
  single refresh for a near-expiry token, and the prefetch exclusion that
  keeps refreshes from racing (commit b39f20f), are unchanged.
- Measured 2026-09-09 from a browser in the Philippines, before the auth
  change: RSC responses of 0.1–1.4 kB took 0.7–1.9 s each (Dashboard
  1.3–1.9 s, MBO/Action Items 0.7–0.9 s, Employees 1.1 s). Almost all of
  that is server time before first byte, not transfer.
- Measured again after the caching and auth deploys: a floor of ~650–710 ms
  on every navigation regardless of page (Skills 712 ms for 1.3 kB, PTO
  660–710 ms, MBO period changes 660–680 ms); MBO's first uncached load
  1.43 s then the floor. Stack Rank stayed 1.4–2.0 s at 80–87 kB per
  response because it rendered the whole 664-row organisation table three
  ways; it now renders the top 20 plus the viewer's neighbourhood unless
  `?all=1`. Analytics (admin only) 1.3–2.2 s. The floor is the next thing
  to explain: Vercel runtime logs show per-request function duration and
  whether the proxy (middleware) runs as its own invocation; if the page
  function itself is fast, the floor is platform overhead, not this code.
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

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
- **Case rate is a KPI (`CASE_RATE`, migration 0041), derived from the
  per-skill facts** by one formula, `blendCaseRate` in
  `src/lib/kpi-engine/case-rate.ts`: the import writes it to the weekly
  ledger (so the action-item engine opens development items off it), and
  period re-aggregation derives it beside PAR. Weeks imported before 0041
  have no ledger row; the employee matrix, agent trend and team comparison
  fill those from the facts, ledger weeks always winning. `npm run
  backfill:case-rate -- --apply` writes the missing rows (add
  `--open-items` to let the engine open items off past failures); after
  that the three gap-fills add nothing and can be deleted. MBO no longer
  opens action items (same migration); its rows stay hidden by the
  `generates_action_items` flag every list reads. Migration 0041 was
  applied to production on 2026-09-10 (~21:00 UTC) through the Supabase
  SQL editor, with the drizzle tracker row inserted by hand afterwards,
  the same way 0039 was. Later that evening (~22:45 UTC) the user ran
  `dedupe:episodes --apply` and then `backfill:case-rate --weeks=2 --apply
  --open-items`: the ledger carries Case Rate for the weeks of 22 and 29
  August 2026 and items were opened off those failures; every earlier
  week still comes from the facts-derived gap-fills. Run the backfill
  without `--weeks` (report first) if the earlier weeks should ever join
  the ledger.
- **Duplicate development-item episodes (fixed 2026-09-10, `fd3ba0a`).**
  The engine only checked live episodes for "already folded", so a
  re-import or backfill of a week whose episode had closed on age opened
  a second episode for the same failure — one agent carried three AHT
  items with identical recent weeks. `loadFoldedResults` in
  `src/lib/action-item-engine/persistence.ts` now also reads what closed
  episodes recorded; `npm run dedupe:episodes` finds and (with `--apply`)
  removes the duplicates that already exist, never touching one with
  human work on it.
- **Every skill is also a KPI (migration 0042).** `kpi_definitions` rows
  with `skill_reference_id` set (code `SKILL_<skill code>`, name = the
  skill's name) stand for one skill each. The import writes one weekly
  row per employee-skill from the same per-skill figures PAR is built
  from (`measureSkillWeek` in `src/lib/kpi-engine/skill-result.ts`: the
  skill's formula against the week's target, ramp stage included; weeks
  under one hour on the skill are not judged), so the action-item engine
  opens one development item per skill missed. `ensureSkillKpis()` in
  commit.ts keeps a KPI row per skill for skills added or renamed later.
  AHT, CPH and CASE_RATE no longer open items (same migration); Quality,
  NPS, Critical Errors and Attendance still do. Rule for readers: anything
  listing "the KPIs" (plan grid, comparison tables, trend chips, the
  analytics by-KPI breakdown, dashboard cards) excludes skill rows —
  `withoutSkills` for period metrics, `isNull(kpiDefinitions
  .skillReferenceId)` on ledger joins — while work-item paths (lists,
  counts, "failing" totals) include them. The employee page's plan grid
  is a fixed allowlist, `PLAN_KPI_CODES` in performance.ts: Production
  Rate, Quality, NPS, Critical Errors, MBO, Attendance, in that order.
  `npm run backfill:skill-results -- --weeks=N` writes skill rows for
  weeks imported before 0042 (`--apply --open-items` to open items).
  Time-and-motion studies attach to handle-time items: the AHT KPI or a
  handle-time skill's item (`isHandleTimeKpi` in
  `src/lib/time-motion/engine.ts` — a skill-linked KPI with direction
  lower_is_better, i.e. OBD Phone, PartD_Phones, Gen_Phones, UHC_west,
  Clinical Appeals Phone), gated the same way on the page and in the
  save action.
  Applied to production 2026-09-10 ~23:10 UTC through the SQL editor.
  Lesson from that rollout: the tracker row was inserted before the
  migration SQL had run, and the deployed code already selected the new
  column, so pages errored until the SQL went in — apply the migration
  before (or with) a deploy that reads a new column, and record the
  tracker row after. The backfill then ran with `--weeks=2` (the weeks
  of 29 August and 5 September 2026): 772 skill-week rows, 254 items
  opened, 12 updated, 75 old items closed on age by the engine's usual
  end-of-run sweep. Earlier weeks have no skill rows.
- **Org history is dated intervals, and a masterlist month outranks a
  weekly file.** `employee_assignments` holds one interval per
  (employee, supervisor/manager/site) span; the period roll-ups take
  whoever covers the most days of the period (`periodOwnerSubquery`).
  Both imports write through `spliceAssignments` in
  `src/lib/org/assignments.ts`: the file replaces the days it covers and
  the newest interval is always left open, so "the latest thing we were
  told" is the current assignment. A masterlist upload writes the whole
  month as one open-ended interval, stamps every interval it rewrites
  with its batch id, and closes anyone active the day before the month
  who is missing from the file (attrition). The weekly import goes
  through `spliceWeeklyAssignments`, which reads committed masterlist
  batches back from `import_batches` (`validation_summary.kind =
  'masterlist'`; `monthStart`/`monthEnd`, or the "September 2026" label
  on the first batches — `masterlistMonthFromBatch`) and, for anyone a
  masterlist listed or closed, trims the file's claims to days outside
  those months and re-closes anyone it would reopen. A hire the
  masterlist never saw is still placed by the weekly file. Rule for
  readers: a weekly file's supervisor column can lag a realignment by
  weeks; the masterlist is the roster of record for its month.
  The period owner falls back to the `employees` snapshot (last import
  wins) only for someone with no history reaching the period at all; a
  person whose history reaches it but covers no day of it was closed by
  a masterlist before it started (`closed` on the owner row) and resolves
  to nobody's team, site or manager for that period — the `*OfRecord`
  helpers in org-history.ts wrap the fallback in `unlessClosed`. The
  same closure feeds `separationDates` in eligibility.ts: a newest
  interval that is closed is a separation on its last day (imports never
  close the newest interval; only a masterlist does), the earlier of it
  and an EWS separating tag winning, so headline headcounts, the MBO
  tree, the stack rank and the comparison matrix all drop the attrited
  from the months after they left. Verified on a local Postgres with a
  five-person scenario (listed, attrited, no history, rehired later,
  blank supervisor EID) for August, September and October.
  The `employees` row is the "now" snapshot the *operational* scope keys
  on (who may open a page, approve leave): both imports end by running
  `syncEmployeeSnapshots` (`src/lib/org/snapshot.ts`) inside their
  transaction, which copies each touched person's open interval onto
  their row. Before that the weekly import wrote the file's own columns
  there and the masterlist wrote nothing, so a team realigned by the
  masterlist appeared on the manager's dashboard (assignments) while
  every one of their pages answered 404 (snapshot). Anyone with no open
  interval — closed by a masterlist, never assigned — is left alone.
- **Records (`/records`) is the read-only archive of action-item work.**
  One row per action item with something written against it — RCA, action
  plan, time-and-motion study or acknowledgement — via `getCoachingRecords`
  in performance.ts (scoped like the action-item list, refused for agents
  by `canViewRecords` in scope.ts, and not filtered by
  `generates_action_items`, so retired AHT records stay visible). The
  detail page reuses `getActionItemDetail` through `getCoachingRecordDetail`
  (adds the category label and the RCA/plan authors' names) and renders the
  same sections as the action-item page with no forms or actions. "Download
  PDF" is `window.print()`: the app header carries `print:hidden`, the
  page band, back link and button are hidden the same way, and each Card
  is `print:break-inside-avoid`, so the browser's save-to-PDF gives a
  clean, text-selectable record. The action-item pages, their components
  and their server actions were not touched.
- **Users page filters and bulk approval.** `/users?status=&position=`
  filters the account list by status and by the sign-up position
  (`employee_profiles.position`; `position=none` for accounts without a
  profile), filtered in the page from the full list rather than in SQL
  since the list is a few dozen rows and the counts need the whole of it.
  "Approve all pending (N)" (`ApprovePending`, second click to confirm)
  sends the ids on screen to `approvePendingUsers`, which activates only
  rows still pending, never the caller's own, keeps roles as they are, and
  writes one `user.approved` audit row per account — so a filtered list
  approves exactly its own rows.
- **EIDs are nine digits everywhere, padded on the way in.** Excel keeps
  an all-digit cell as a number unless the column is text, so the same
  supervisor arrives as "001305110" from one sheet and 1305110 from
  another. The roster parser always padded; the weekly parser did not,
  and every EID match (a team leader's account, the period owner, the
  roster of record) compares the padded form, so an unpadded Sup EID
  matched nobody — one team leader's August read 6 agents against 16 in
  the file. `normalizeEid` in columns.ts pads any 1–9 digit value; the
  weekly parser uses it for supervisor EIDs (`captureOrgWeek`,
  `captureEmployee`). Agent EIDs are left as they come until the data is
  checked for short ones, since padding them could split an existing
  employee row in two. Historical rows need a one-off `lpad` repair.
  The real cause of that "6 against 16" was different, though: 20 of her
  agents' August stints carried her name and no EID at all, because the
  last sheet read for them (the sheets go Productivity, Quality, NPS,
  Attendance, Feedback; the last row read wins per agent-week) has a
  Supervisor column but no Sup EID column. Two fixes: the parser fills a
  name-only row from any row in the same workbook that names the same
  supervisor with an EID (`fillSupervisorEids`, unambiguous names only),
  and `periodOwnerSubquery` resolves a stint's missing EID through
  `eid_by_name` — the most frequent EID that exact name string carries
  anywhere in the history — before the employee-row fallback. Historical
  rows were repaired with the same name lookup on 2026-09-12 (one UPDATE
  each on `employee_assignments` and `employees`): 3,129 history rows
  had a supervisor name and no EID, org-wide — every team leader's past
  months were short the same way. Afterwards the name-only rows are
  gone and Lea's August resolves to 20 agents under her EID.
- **The dashboard's period cards follow the period's team.** For a
  leader, everything about the selected period on `/dashboard` — the stat
  cards, the team trend, the by-agent comparison and its open counts —
  uses `reportingScopeIds(user, period)` (the assignment history), not
  `resolveScopedIds` (who reports to them now). The two drift apart with
  every realignment: a supervisor whose team had since moved on saw "0/1"
  and MBO 0% built from one stale row beside a table of her real July
  team. Only the action-item panels stay operational, since open work
  belongs to whoever leads the person now.
- **Separation is date-based everywhere, and the masterlist records it.**
  `separationDates` (EWS Black/Absconding tag date, or a masterlist
  closure's last day — the earlier wins) already decided who counts in
  every period figure. `separatedBefore(date)` in eligibility.ts applies
  the same rule to the lists: the Employees roster hides anyone who left
  before the viewed week starts, and the Time Off calendar anyone who left
  before the viewed month — they still show for the week or month they
  left and every earlier one. A masterlist commit now does what an EWS
  attrition tag does: marks the closed people `separated` (audit row each,
  `from: "masterlist"`), closes their open action items as of the last
  week they were on the roster (`closeIssuesOnSeparationFor`, four
  statements for the whole batch, inside the commit transaction), and
  marks anyone it lists again after an earlier closure `active`. People on
  leave are left on leave.
- **Open work of anyone already gone is closed on every engine run.** The
  EWS tag and the masterlist close a person's issues at the moment they
  record the separation, but only since those hooks existed (7 and 11
  September) and only for the person whose status they changed right
  then, so an agent tagged earlier, or dropped by an earlier month's
  roster, kept an open item on the leader's Action Items list for good:
  the engine never opened new work for someone inactive but never closed
  what was there, and the age-out rule refuses an issue whose last result
  is a failure — the usual last week of someone who left.
  `closeIssuesOfSeparated` (persistence.ts; end of `runIssueEngineForWeeks`,
  so every weekly import runs it; also `npm run close-separated [-- --apply]`)
  closes every open issue of anyone `separationDates` says has left by
  today, resolved as of the week they left (`separationResolutionWeeks`
  in engine.ts groups them so it is one statement per week), with the same
  `issue.closed_on_separation` audit row. The EWS hook now closes whether
  or not the status changed just then (a masterlist may have marked them
  first) and as of the tag's date, and the masterlist closes work for
  everyone it closes, not only the newly marked. Found on 12 Sep through
  one agent under a team leader: tagged Black in July before the hook
  existed, then closed by a September roster committed before the
  masterlist change, status still `active`, one item open since
  February. The administrator ran the one-person version of the sweep
  by hand in the SQL editor (issue and item COMPLETED, resolved week
  2026-07-18, audit row); the rest of the backlog closes at the next
  weekly import.
- **A limited database role for the deployed app, and a weekly backup.**
  `scripts/sql/app-role.sql` (idempotent; paste into the SQL editor as
  postgres after replacing CHANGE_ME) creates `emr_app`: login, DML on
  every public table and sequence, the same by default privilege on
  tables postgres creates later, `select` on `auth.mfa_factors` for the
  Users page (best effort), and an allow-all RLS policy
  `emr_app_full_access` per public table — needed because RLS is on
  everywhere and a non-owner role is subject to it. It cannot do DDL,
  read the rest of the auth schema, or reach other schemas. Production
  `DATABASE_URL` on Vercel then uses `emr_app.<ref>` through the same
  pooler; `.env.local` keeps the postgres role for migrations and
  backups. Re-run the SQL after any migration that adds a table, or the
  app cannot see it. `npm run backup` (`scripts/backup-db.sh`) dumps the
  public schema with pg_dump (`brew install libpq`) to
  `~/EMR-backups/emr-YYYY-MM-DD.dump`, switching a 6543 URL to the 5432
  session pooler, keeping the eight newest; restore notes are in the
  script header (re-run app-role.sql afterwards, grants are not dumped).
  Accounts live in Supabase's auth schema and are outside the dump.
  Done 13 Sep (Manila time): the role created (30 tables readable),
  production `DATABASE_URL` switched to `emr_app` and redeployed, the
  first dump taken (21 MB), and the Monday 06:00 cron installed on the
  administrator's Mac mini with the PATH line for Homebrew's libpq. The
  off-machine copy is an external SSD mounted as `/Volumes/Mac Storage`:
  `rsync -av ~/EMR-backups/ "/Volumes/Mac Storage/EMR-backups/"`, run by
  hand (first copy confirmed 13 Sep 06:35 Manila, one 20 MB dump); it
  adds files and never deletes, so the SSD keeps what the Mac mini
  trims. A second cron line, 06:15 Monday, runs the same copy when the
  drive is mounted (`[ -d "/Volumes/Mac Storage" ] && rsync -a …`),
  installed 13 Sep. macOS may block a cron job from a removable volume
  until Terminal has been allowed once, so if a Monday dump is on the
  Mac mini but not the SSD, run the rsync by hand once. Incident the same
  morning: the placeholder in app-role.sql
  was replaced with the real password through GitHub's web editor and
  committed to main (two "Update app-role.sql" commits), so the file was
  restored to the placeholder with a warning comment and the role's
  password rotated (`alter role emr_app password`) and re-entered in
  Vercel. The old value remains in history and is dead; the history was
  not rewritten. Rule: the password is typed into the SQL editor, never
  into the file.
- **An EOD send that stalls now ends with a reason instead of a screen
  that never finishes (13 Sep).** Reported after the Brevo switch: the
  sending scene reached its last check and stayed there. Two faults.
  The transport in `my-stats/actions.ts` had nodemailer's defaults (two
  minutes to connect, ten of silence before giving up), so a relay that
  stopped answering held the action until the platform killed the
  function; and `sendEod` in `case-tracker.tsx` awaited the action
  without a catch, so a request that ended in a throw (function time
  limit, dropped connection, deploy rollover) left `eodPhase` on
  "sending" for good. Now `SMTP_TIMEOUTS` caps DNS, connect and greeting
  at 10 s and inactivity at 30 s, `requireTLS` is set on any port but
  465 so the login never goes over a plain connection, environment
  values are trimmed, and a failed send returns
  `describeSmtpFailure(cause, {host, port})` (`src/lib/mail/smtp-error.ts`,
  tested): the nodemailer `code` picks the sentence (EAUTH → check
  EOD_SMTP_USER/PASS, ETIMEDOUT/ECONNECTION → host and port, EENVELOPE
  → addresses, EMESSAGE → message) and the relay's own response line
  is quoted, so a 535 or a 550 reads as such on the page. The same
  fields go to `console.error("[eod] send failed", …)` for the Vercel
  Logs page. The tracker catches a throw and shows
  `describeActionError(cause, fallback)` — the helper now takes the
  fallback sentence, because unlike a save, a send that did not report
  back may still have gone through and the message says to check with
  the team lead before resending. The cause of that night's stall was
  not established from the code alone; with this in place the next
  attempt names it. The next send after the deploy went through.
- **The sender is copied on every EOD report (13 Sep).** Asked for once
  the first report arrived: nothing about a report is stored server-side,
  so the CC is the agent's only record of what went out. `sendEodEmail`
  sets `cc` to the sender's account address (already a known address, so
  it bypasses no recipient rule), skipped when the report is addressed to
  themselves, and the `eod.sent` audit row records it as `after.cc`.
  Brevo counts recipients, so each report now costs two of the free
  relay's 300 daily sends; the card subtitle says a copy goes to the
  sender's inbox.
- **A half-finished authenticator enrolment no longer blocks `/mfa`
  (13 Sep).** Reported on a test agent account: "A factor with the
  friendly name 'Authenticator app' for this user already exists." The
  form meant to clear unverified factors before enrolling, but read them
  from `listFactors().data.totp`, and Supabase fills the per-type lists
  with *verified* factors only — an unverified one (page closed before
  the first code) is in `data.all` and nowhere else — so the cleanup
  never ran. `totpFactors(all)` in `src/lib/auth/mfa.ts` (tested) sorts
  an account's TOTP factors into the verified one and the stale ones; the
  form reads `all`, unenrols the stale, and retries the enrolment once
  if the relay still says "already exists" (a factor written between
  the list and the enrol). The admin Reset on the Users page was never
  affected: it lists through the admin API, which returns every factor.
- **201 file: search, filters, and twenty rows at a time (feature branch,
  13 Sep).** The page used to render every registered report in one
  table. It now hands the whole scope (registered or not, with the
  employee's standing) to a client component, `PersonnelTable`
  (`201-file/personnel-table.tsx`), which filters in the browser as you
  type — nothing goes back to the server. Rules in
  `src/lib/201-file/filter.ts` (tested): the search matches every term
  against the roster name, the profile name, EID, MSID, email, phone and
  position, folding case, accents and punctuation; selects for team
  leader and site appear only when the scope has more than one; Standing
  (active, on leave, separated); and Show (Registered — the default and
  what the page always showed — Not yet registered, Everyone), so a
  leader can finally list who has not signed up. `PAGE_SIZE` (20) rows
  render first; an IntersectionObserver on a footer sentinel adds twenty
  more as the reader nears the end, with a "Show N more" button as the
  fallback. Any filter change starts the list over at twenty. An
  unregistered row shows the roster name and EID and one italic note
  across the other columns.
- **Quality Audit module (feature branch, 13 Sep).** From the handoff
  (`Quality Audit.dc.html` + README): leaders audit agents against the
  four QA forms and track a weekly requirement. Tables (migration
  `0043_quality_audit`, numbered after `0042_skill_kpis` — the generator
  wanted `0042_` again and overwrote `meta/0042_snapshot.json`, restored
  from git; the new snapshot is `0043_snapshot.json`): `qa_forms` (key,
  label, `header_fields` jsonb, `definition` jsonb, sort order; seeded by
  the migration from `QA_FORM_SEED` in `src/lib/quality/forms.ts`,
  `on conflict do nothing`), `qa_audits` (agent, form, evaluator,
  `audit_date`, header values, concatenated remarks, earned/max points,
  `score_pct` numeric(5,2), `is_critical`), `qa_audit_results` (one row
  per scored attribute: category, attribute, is_compliance, pass/fail).
  The migration also grants the three tables to `emr_app` if that role
  exists. **Applying it: this project's migrations reach production
  through the Supabase SQL editor as postgres, with the drizzle tracker
  row inserted in the same paste (as 0039 and 0041 were) —
  `drizzle/APPLY_0043_QUALITY_AUDIT.sql` is that paste, one transaction,
  safe to run twice; then re-run `scripts/sql/app-role.sql` for the
  policies. `npm run db:migrate` from the Mac mini reported done on 13
  Sep but created nothing (the pages errored "relation qa_forms does not
  exist" until the paste went in), so do not rely on it.** Scoring (`src/lib/quality/scoring.ts`, tested): a
  category-weighted form (Phone, MPA QA, Fax QA — maxima 100, 86, 29)
  forfeits a category's whole weight on any failed criterion; the flat
  AV QA form (max 100) deducts each failed item's own points; any
  compliance failure zeroes the score and marks the audit critical;
  outcome Pass ≥ 90, Monitor ≥ 70, else Fail. Unmarked attributes are
  passes. The server rescored from the stored form on submit and never
  trusts the page's score. Weekly requirement (`week.ts`): audit weeks run
  **Sunday–Saturday** (the handoff's rule; unlike the Sat–Fri reporting
  week), 2 audits per active agent; an agent is out for the week when
  separated before it, on leave of absence, or on approved leave covering
  all seven days (`pto_requests`); the roster does not list the separated
  at all (asked for 13 Sep), only the other two as "not required". Pages under `/quality` (tab strip:
  Dashboard, New audit, History, Team QA analysis; nav tab for
  admin/manager/supervisor via `LEADER_NAV`): the dashboard's roster with
  Previous/This week/Next; the New audit stepper (`new/audit-form.tsx`:
  agent + form + audit date + the form's header fields — Evaluator is the
  signed-in user, and the workbook's "Tech Name"/"Agent Name" header
  fields are dropped since the agent select is that; one category per
  step, Pass/Fail per attribute, Pass all/Fail all, per-category remarks,
  live score, compliance last); History with a detail drawer and CSV
  downloads (`/quality/export` route handler: `?audit=<id>` for one
  audit's raw rows, none for every finding in scope — the only bulk
  export); Team QA Analysis (`analysis.ts`, tested: last 14 days / 12
  weeks / 12 months by grain, each compared with the equal span before
  it; score trend against the 90% line, score by team leader or manager,
  outcome donut, error categories, critical-error trend, top findings).
  Access: `canAuditQuality` (admin/manager/supervisor) in scope.ts reads
  the module; `canFileAudit` (supervisor only, asked for on 13 Sep once
  the page was live — "they don't need to audit") files: the New audit
  tab and the roster's Audit button are drawn only for a team leader,
  `/quality/new` sends anyone else to the dashboard, and `submitAudit`
  refuses them (`NOT_AN_EVALUATOR`). Every query and the action go
  through `resolveScopedIds`, so a supervisor audits their team, a
  manager reads their span, an admin everyone; an agent reaches no query
  (`quality/authorization.test.ts`). Audit filing writes
  `audit_log` action `qa.audit_filed`. Live 13 Sep: the administrator ran
  the migration and app-role.sql, then the merge (production 03:31 UTC).
- **Incident: the middleware could be skipped by header, and the identity
  headers were trusted (found 13 Sep in the full audit, fixed the same
  hour).** `middleware.ts`'s matcher carried Next's documented `missing`
  conditions to skip prefetch requests (`next-router-prefetch`, `purpose:
  prefetch`) — added to keep viewport prefetches out of the refresh-token
  race. But every page and action reads `x-user-id`, `x-session-aal` and
  `x-request-kind` on the assumption the middleware always overwrites
  them, so a request carrying a prefetch header and its own `x-user-id`
  reached the pages unverified: any account, including admin, for reads
  (the 201 file, exports) and for server actions (a `Next-Action` POST).
  No sign it was used; the Vercel logs would show such requests as
  prefetch-marked hits on data pages without a session cookie. Fix: the
  matcher has no header conditions at all (`src/middleware.test.ts`
  guards this), the middleware deletes the three headers before anything
  else on every request, and a prefetch is verified on the cookie's token
  as it stands — `accessTokenFromCookies` in `src/lib/auth/session-cookie.ts`
  (tested) reads the SSR client's chunked, base64-prefixed session cookie
  and `getClaims(token)` checks signature and expiry with no refresh — so
  the race the exclusion avoided is still avoided; only a real navigation
  refreshes. An expired token on a prefetch renders that prefetch as
  signed out; the click that follows refreshes normally. Also from the
  same review: the slower `getUser()` path now reports `aal` from the
  verified token's claims, and an unreadable level ("unknown") is not
  enforced by the layout or `getCurrentUser` either, matching the
  middleware, so a cold-instance JWKS failure no longer loops a manager
  between `/mfa` and the page. And `x-user-id` is deleted, not merely
  left alone, when there is no session.
- **Full audit, 13 Sep — what was checked and what changed.** Static:
  typecheck, lint, 790-odd tests, production build. Structural: the
  drizzle snapshot chain is unbroken, every journal tag has its SQL, each
  APPLY file's recorded hash matches its migration, `drizzle-kit
  generate` reports nothing pending. Runtime (a local production build,
  since this sandbox cannot reach vercel.app): every route redirects to
  `/login` when signed out, `/login` is 200, the security headers are
  present, and the forged-identity request above is now redirected. Two
  independent code reviews of the recent modules found, besides the
  incident above: `?week=2026-13-45` crashed the Quality dashboard
  (`isIsoDate` in `week.ts` now checks a real calendar date, shared with
  `submitAudit`, which also allows one day ahead of UTC for floors east
  of it and refuses an audit for someone who had left before that week —
  `AGENT_LEFT` — while `getQaAgentOptions` lists exactly whom the roster
  says owes audits, so a mid-week leaver is auditable for that week);
  the stepper's date now defaults to and is capped at the evaluator's own
  local today (`useSyncExternalStore`, no effect); the CSV exports carry
  a UTF-8 BOM (`CSV_BOM`) so Excel reads the dashes, text cells that start
  like a formula get a leading space, and the bulk file's Time & Motion
  delta is a number; the 201 file joins personnel details through the
  account's verified link (`users.employee_eid`), not the profile's copy
  of the sign-up claim, so a corrected ID no longer files one person's
  address under another's row; `decidableLeaderIds`' link branch ignores
  reports without a manager name, as `managerNameFor` does, so a leader
  decidable by a manager also appears in that manager's queue; a user
  row's cluster value is blank for roles that carry none, so a role change
  leaves no stale link; the EOD `From` header is built by nodemailer from
  a name and address rather than by string interpolation. Left as is,
  for a decision: the Users list orders by the status enum (disabled,
  pending, active); if pending belongs first, say so.
- **Time & Motion on Phone audits (feature branch, 13 Sep).** The third
  handoff (the Quality Audit design again, plus a "Time & Motion (Phone
  Form only)" section): a floating side panel on the New audit page — a
  bottom-right toggle reading "Time & Motion · filled/total", a panel
  with a call reference and, per segment, an editable baseline (seconds,
  pre-filled from the form) and the actual, with the delta and totals —
  logged alongside the scoring and never part of the score. Required in
  full: Submit with any actual blank opens the panel and shows "Complete
  Time & Motion (all segments) before submitting." beside the button,
  clearing itself once every segment has a value; `submitAudit` refuses
  the same way server-side (`validateStoredTimeMotion`). Storage is one
  jsonb column, `qa_audits.time_motion` `{callReference, segments:
  [{label, baselineSeconds, actualSeconds}]}` (migration
  `0045_qa_time_motion`, apply with `drizzle/APPLY_0045_QA_TIME_MOTION.sql`;
  it also writes the five segments into the Phone form's stored
  definition as `definition.timeMotion` — Greeting / verification 30,
  Account lookup 60, Issue discussion 240, Resolution / hold 90, Wrap-up
  60 — the same values `QA_FORM_SEED` carries). Pure helpers in
  `src/lib/quality/time-motion.ts` (tested). Both CSV exports carry it:
  the per-audit file gets a call-reference line and a Segment / Baseline
  / Actual / Delta block between the header and the attributes; the bulk
  file gets one row per segment under category "Time & Motion" with the
  signed delta in the result column. The leaders' History drawer lists
  the segments. Only forms whose definition carries `timeMotion` show the
  panel or require it; the other three do not. Live 13 Sep: the
  administrator ran the 0045 paste (1 and 5 confirmed), then the merge
  (production 04:06 UTC). The APPLY files from 0045 on guard the tracker
  insert with `where not exists` — the tracker has no unique key, so
  `on conflict do nothing` never stopped a duplicate row.
- **My Quality Scores, the agent-facing page (feature branch, 13 Sep).**
  From the second handoff (`My Quality Scores.dc.html` + README):
  `/my-quality-scores` for the agent role (nav tab in `AGENT_NAV`; any
  other role is sent to `/quality`), reading the same `qa_audits` /
  `qa_audit_results` / `qa_forms` — no second data model. Scope is the
  employee row the account is linked to (`getMyQualityScores`: agent role
  + `employeeEid` → `employees.eid`; anything else returns null before a
  query). Content: the four KPIs (audits received, average, pass rate on
  the leaders' rule, latest), a score trend with the 90% line and red
  points where any attribute failed (`score-trend.tsx`), "Areas to focus
  on" (their own most frequent failed attributes, "No recurring findings
  — nice work" when none), and the audit table with a drawer: findings
  or "No findings — clean audit", the team lead's remarks, "View full
  audit form" (every attribute with its Pass/Fail tag), and Acknowledge
  review. Acknowledgement is two columns on `qa_audits`
  (`acknowledged_at`, `acknowledged_by`; migration `0044_qa_acknowledgement`,
  apply with `drizzle/APPLY_0044_QA_ACKNOWLEDGEMENT.sql` in the SQL
  editor, nothing to re-grant) rather than the `acknowledgements` table,
  which is keyed to an action item and belongs to the coaching workflow
  the handoff said not to touch. `acknowledgeAudit` updates only where
  the audit's `agent_id` is the caller's own employee row and it is not
  yet acknowledged, and writes `audit_log` `qa.audit_acknowledged`; the
  leaders' History drawer shows "Acknowledged <date>" or "Not yet". Pure
  summary in `src/lib/quality/my-scores.ts` (tested); role and link gates
  in `my-quality-scores/authorization.test.ts`. The migration generator
  again named the file `0043_` (it numbers by journal index, one behind
  this repo's names) and overwrote `meta/0043_snapshot.json`; renumbered
  to 0044 and the snapshot restored from git, as for 0043. Live 13 Sep:
  the administrator ran the 0044 paste, then the merge (production 03:55
  UTC).
- **Trainer and SME, the support roles (feature branch, 13 Sep).** Two
  new `user_role` values plus `qa_audits.counts_for_requirement`
  (migration `0046_support_roles`; apply with
  `drizzle/APPLY_0046_SUPPORT_ROLES.sql` in the SQL editor — enum values
  and column are added `IF NOT EXISTS`, nothing to re-grant; rehearsed
  twice on a scratch database, second run a no-op). The request: a team
  leader's view over the whole floor, minus the team leader's own
  tooling, and their audits never complete a team leader's requirement.
  The role table is `src/lib/auth/scope.ts`, pinned by `scope.test.ts`:
  `isSupportRole`; `employeeScope` is `"all"` for them with or without an
  employee link (so the dashboard, Employees, Action Items, Records,
  Development Hub, Stack Rank, Quality Audit and the 201 file are
  floor-wide — the 201 file includes everyone's personal details, as
  asked; reverse in `LEADER_NAV` and `201-file/page.tsx` if that is too
  much); `canFileAudit` on anyone; `canManageActionItems` like a team
  leader (a judgement call — coaching plans from a trainer read as
  intended; flip it there if not); `canRunTeamPrograms` (new: admin and
  supervisor only) gates `saveEwsAssessment` and the ramp actions, and
  the employee page hides the EWS panel from them, so "no EWS/Ramp" holds
  through the employee page and server actions, not just the nav. Nav
  (`app-header.tsx`): no Time Off, Skills/"My Tools", EWS, Ramp or
  Adherence; MBO, Quality Audit, 201 File stay. Pages back it: `/pto`,
  `/ews`, `/ramp`, `/adherence`, `/skills` redirect them to the dashboard,
  and the PTO and adherence actions refuse them ("Time off is not filed
  here for a trainer or SME account."). Dashboard: the team-lead layout
  ("All teams"), which puts `getTeamPeriodComparison` and the agent table
  over 600-odd rows — the widest use of that page yet, not measured in
  production; if it is slow, the admin's org-wide view is the fallback
  (`isSupervisor` in `dashboard/page.tsx`). Quality: `countsForRequirement`
  (supervisor only) is stamped on every audit; the roster count query in
  `src/lib/queries/quality.ts` and therefore the requirement, the
  "Completed" card ("By the agent's team lead") and the two-per-agent
  standing count only `counts_for_requirement = true`, while History
  (evaluator shows "· support"), Analysis, the export and the agent's My
  Quality Scores include every audit. Also: `MFA_ROLES` requires `aal2`
  for them like the other leaders; `reportingScopeIds` treats them as an
  admin; the Users page offers "Trainer"/"SME" (`ROLE_LABELS`) and the
  `updateUser` schema, the implied-role map and
  `scripts/set-user-role.mts` accept them; the authorization tests for
  `/quality`, `/my-quality-scores` and the admin pages cover both roles.
- **New Audit: the agent picker is a search box (feature branch, 13
  Sep).** Asked for from the New Audit screen; a dropdown of the whole
  floor is unusable for a trainer or SME, and a scroll for a team leader.
  `quality/new/agent-search.tsx` is a combobox over the same
  `getQaAgentOptions` list (which now carries `eid` and `supervisorName`
  too): type part of a name, employee ID or team leader; arrows, Enter,
  Escape and click work; the chosen name stays in the box with the EID
  and team leader under it, and typing over it or the × starts a new
  search. `?agent=<id>` from the roster still preselects. Matching is
  pure and tested (`src/lib/quality/agent-search.ts`: every term must
  appear, case/accents/punctuation folded, names beginning with the query
  rank first, eight shown with a "showing 8 of n" line, an empty query
  shows the first eight so a short team needs no typing). Options use
  mousedown rather than click because the input's blur fires between the
  two and would close the list first. Live 13 Sep, and the first look
  showed the list cut off at the card's edge: `Card` is
  `overflow-hidden`, so the "Set up audit" card gets `overflow-visible!`
  (Tailwind v4's important suffix — plain `overflow-visible` cannot be
  relied on to win over the base class). Any other floating list inside a
  `Card` needs the same.
- **Phone audit Time & Motion runs the action item's stopwatch (feature
  branch, 13 Sep).** The QA panel had its own five segments (Greeting /
  verification … Wrap-up, 480s) and typed-in seconds; the action item's
  study times Opening & Verification / Identify the Concern /
  Investigation / Delivery of Findings / Closing (30/45/120/75/30) on a
  live clock with Start call, Hold, Complete segment, Reset. One call is
  now timed the same way in both places: the clock is
  `src/components/call-timer.tsx` (`CallTimer`, extracted unchanged from
  the action-item `LiveTimer`, which now wraps it with the call
  reference, remarks and save), and the Phone form's segments are
  `DEFAULT_SEGMENTS` from `src/lib/time-motion/engine.ts` — in the seed
  (`forms.ts`) and in production through migration
  `0047_qa_time_motion_segments` (a custom data migration, no snapshot,
  like 0033–0037; apply with `drizzle/APPLY_0047_QA_TIME_MOTION_SEGMENTS.sql`,
  updates the row only while its segments differ, nothing to re-grant;
  rehearsed twice on a scratch database). The QA panel
  (`quality/new/time-motion-panel.tsx`) is the call reference plus the
  clock; `applyTimer` (tested) copies every baseline and each completed
  segment's whole seconds into the draft, so `finalizeDraft`, the stored
  shape, History, the export and My Quality Scores are untouched; past
  audits keep the segments they were filed with. The aside stays mounted
  while closed (`hidden`, not unmounted) so the clock keeps running while
  the QA steps are scored, and the corner toggle shows "● Running".
- **Audit date locked to today, transaction date added, every category
  must be opened (feature branch, 13 Sep).** Three asks from the first
  live audit. (1) The audit date is the day the audit is filed: the New
  Audit page shows it disabled (the browser's local today, as before) and
  `submitAudit` refuses anything but the server's UTC today give or take
  one day (`AUDIT_DATE_NOT_TODAY`) — the give-or-take is Manila being
  east of UTC, not slack. (2) `qa_audits.transaction_date` (date, null on
  earlier audits; migration `0048_transaction_date`, apply with
  `drizzle/APPLY_0048_TRANSACTION_DATE.sql`, `IF NOT EXISTS`, nothing to
  re-grant, rehearsed twice on a scratch database) is the date of the
  call, case or fax: required on the page (submit stays disabled with
  "Enter the transaction date to submit."), a real date no later than the
  audit date on the server (`TRANSACTION_DATE_MISSING`,
  `TRANSACTION_DATE_AFTER_AUDIT`). It shows as a "Transaction" column and
  in the drawer on History ("Audited … · Transaction …"), in the agent's
  My Quality Scores drawer, and in both exports — the bulk CSV gained a
  "Transaction date" column after "Date", so anything keyed on column
  positions moves one to the right (the csv tests did). The generator
  named the file `0047_` again and this time overwrote nothing (0047 is a
  custom data migration with no snapshot); renumbered to 0048. (3) The
  category list's "pending" is now a gate: `pendingSteps` counts steps
  never opened (`statusOf` === "pending") and the submit button stays
  disabled with "Review every category before submitting — n still
  pending." Client-side only; the server cannot know what was looked at.
  The authorization tests date their filing `today` (UTC) with a
  transaction date of the same day, since the date rules run before the
  scope check.
- **Profile panel behind the name in the header (feature branch, 13
  Sep).** From the handoff (`Profile Panel Mockup.dc.html` + README): the
  identity block in `AppHeader` is a button (`ProfilePanel` in
  `src/components/profile-panel.tsx`, a client component that owns the
  button and the panel) opening a 420px panel from the right edge over a
  backdrop — navy header with initials, name, role and email; Profile
  (first/last/middle name editable; Employee ID, Position, Team leader,
  Manager read-only from the roster, with the "ask an administrator"
  line); Contact; Emergency contact; Security (link to `/mfa`); Quick
  links (agent: My Tools + My Quality Scores; team leader: My Tools =
  `/skills`; other roles: section hidden); footer with "Saved" (2s),
  "Unsaved changes", Cancel (discards) and Save changes (disabled until
  something changed). Escape, the backdrop, × and Cancel all close and
  reset to the last saved values. The panel is seeded server-side: the
  header's one round trip now also reads the caller's `employee_profiles`
  row and the linked employee's `supervisor_name`/`manager_name`
  (`Promise.all`, so no added latency). `updateMyProfile`
  (`(shell)/profile/actions.ts`) finds the row by the account, never by
  an id from the page, writes only the twelve editable columns (never
  `employee_eid`, `msid` or `position`), refuses when nothing changed,
  and logs `profile.updated` with just the changed fields; checks live in
  `src/lib/profile/panel.ts` (`validateProfileForm`: names required,
  phone numbers 7–15 digits with the usual punctuation, zipcode 3–10
  letters/digits, every field ≤ 200 chars) and run on the page and in the
  action alike. An account with no profile row (created from the
  Supabase dashboard, or pre-dating profiles) sees the note and the
  read-only fields only. The header's "Security" box went once the panel
  carried "Manage security & MFA" (asked for, 13 Sep); `/mfa` stays
  reachable from the panel and by URL. Decision: the account name (`users.name`) is not
  edited here — it is what every evaluator/leader/audit label shows and
  what an unlinked manager's scope falls back to — so the panel header
  shows the account name while the Profile section edits the personnel
  record; flagged to the user. No migration.
- **Profile pictures (feature branch, 13 Sep).** Asked for right after
  the panel shipped. `user_avatars` (migration `0049_user_avatars`; apply
  with `drizzle/APPLY_0049_USER_AVATARS.sql`, which also creates the
  `emr_app_full_access` policy on the new table — the one thing
  re-running `scripts/sql/app-role.sql` would add; rehearsed twice on a
  scratch database): `user_id` PK → users cascade, `content_type`,
  `image` (base64, no prefix), `updated_at`. Its own table because
  `users` is read on every request and a picture is tens of KB. The
  browser does the work: `squareDataUrl` in `profile-panel.tsx` cuts the
  chosen photo to a centred 256px square through a canvas (WebP at 0.85,
  JPEG where WebP cannot be encoded; `imageOrientation: "from-image"` so
  phone photos come out upright), so the upload is 10–30 KB;
  `updateMyAvatar` re-checks that what arrived is a PNG/JPEG/WebP data
  URL under 200 KB decoded (`parseAvatarDataUrl`, tested), upserts the
  caller's own row and logs `avatar.updated` with the type and size only.
  Served by `GET /profile/avatar` — the caller's own picture only —
  with `Cache-Control: private, max-age=31536000, immutable`; the header
  passes the row's timestamp as `?v=`, so a new upload is a new URL and
  the old one can be cached for good. The header's `Promise.all` gained
  the timestamp read (nothing else). The picture shows in the header
  button (32px) and the panel (56px), in colour — the one image that
  is: `data-keep-color` opts it out of the grayscale rule
  (`img:not([data-keep-color])` in globals.css), as asked. "Add/Change photo"
  and "Remove" sit under the name in the panel header; status and
  refusals show right there. Accepts PNG, JPEG, WebP — not HEIC, which
  browsers cannot decode; an iPhone set to "Most compatible" sends JPEG.
- **"Focus Tech" on the team leader's dashboard (feature branch, 13
  Sep).** Under the Action Items block in the summary column: the five
  agents furthest from target this period, worst first, each linking to
  their page with "n below target · m at risk · <worst KPI> actual vs
  target". Pure and tested in `src/lib/dashboard/focus.ts`
  (`focusAgents`): rank by KPIs below target, then at risk, then the
  relative size of the worst miss (direction-aware; range/boolean KPIs
  count as no gap), then name; the "worst" measure is a failing one when
  any fails, the largest relative miss among those. Built on the page
  from `periodMetrics` (already fetched, skills excluded) and named from
  the comparison's rows, so it costs no query; support roles get it over
  the floor since they share the layout. Same change fixed the card's
  "18 of 1 with data": `total` was the week summary's count of today's
  roster while `measured` counted the period's team by assignment
  history — now both are the period's team (`teamIds.length`).
- **Employee page: the "Development item" table is gone; figures link
  to their action item (feature branch, 14 Sep).** Asked for as
  redundant: the expandable per-item Pass/Fail grid under the Development
  plan repeated what the KPI grid's red cells already said. Now any figure
  in the Development plan grid or the Skill breakdown that an action item
  was evaluating that week is a dotted link to `/action-items/<id>`
  (`LinkedFigure` in `progress-matrix.tsx`; the hover text carries the
  item code and what the week meant — opened, failed and counter reset,
  passed n of 4, passed before acknowledgement, has a note; the note dot
  survives). The lookup is pure and tested
  (`src/lib/development/item-links.ts`, `actionItemLinks`: one link per
  KPI-week in an item's history, the live episode winning over a closed
  one that covers the same week). Skill rows carry their KPI code now
  (`SkillBreakdownRow.kpiCode` = `skillKpiCode(ref.code)`) so an item on
  a skill KPI is found the same way. `isDevelopmentItemStale` in
  `performance.ts` is no longer used by the UI (its tests still pin it);
  remove both when convenient.
- **Scorecard audit follow-ups (main, 14 Sep).** A read-through after the
  scorecard went live found two small things. "Today" for the review
  lock, the "running month to date" label and the month lists (Scorecard
  and Stack Rank) was the server's UTC date, which would open a month's
  review at 8 AM Manila on the tenth and keep a new month off the list
  until 8 AM on the first; `todayInManila()` in `review.ts` (tested) is
  the calendar now. And the Monthly sheet read the agent EID as typed
  (`toText`, like the weekly sheets): a hand-typed sheet with an
  all-digit cell would carry 1919795 and create a second person instead
  of reaching 001919795, so `readMonthlySheet` pads it with
  `normalizeEid` (tested with a numeric cell). The weekly sheets are
  unchanged: the workbook keeps their EIDs as text.
- **Scorecard table hides its dash rows (feature branch, 14 Sep).**
  Asked for: a row with nothing to show — `no-weight` (no hours on that
  side: Phone Quality and NPS for a pure ancillary agent) or `no-data`
  (weight but nothing measured) — is left off the table instead of
  printed as "--". The engine still carries them (the score and its
  rescaling are unchanged); the Total weightage line names any
  measured-but-missing row ("Ancillary Quality not measured — read over
  the 80% that could be scored") so a rescaled score still explains
  itself.
- **Scorecard PDF on one page (main, 14 Sep).** The first signed print
  ran to two pages: the acknowledgement card (break-inside-avoid) did not
  fit under the table and moved whole to page 2, leaving page 1 a third
  empty. Print-only compaction on the page: 7mm margin, tighter header
  card (smaller month and score type, no row gaps in the details list),
  signature areas 3rem instead of 5rem, and the acknowledgement grid's
  padding halved. The table's own print sizes are unchanged.
- **Signatures on the scorecard stamps (feature branch, 14 Sep).** "Mark
  as reviewed" and "Acknowledge" now open a signature dialog
  (`signature-dialog.tsx` over a pointer-event canvas, `signature-pad.tsx`,
  600×200 pad space, mouse/pen/finger, Clear, Escape cancels); confirming
  an empty pad is impossible client-side and refused server-side ("Draw
  your signature before confirming"). Strokes are stored as vector data,
  not a picture — `Signature {w, h, strokes: number[][]}` validated by
  `signatureSchema` in `src/lib/scorecard/signature.ts` (integer points,
  even-length strokes, ≤ 20,000 points, `hasInk` ≥ 2 points) — in two
  jsonb columns on `scorecard_reviews` (migration
  `0052_scorecard_signatures` / `APPLY_0052_SCORECARD_SIGNATURES.sql`,
  rehearsed twice; run after 0051). A re-review replaces the leader's
  signature and clears the agent's with the acknowledgement. The card and
  the PDF draw them back as SVG (`SignatureImage`, `signaturePath`) on the
  signature lines with "Signed Sep 14, 2026, 2:42 PM Manila time"
  (`signedAt`, Asia/Manila). The audit log entries note `signed: true`.
  Also asked for in the same round: the table's column band is navy with
  orange lettering and an orange rule (`bg-navy-800`), the final-score
  row stays orange.
- **Scorecard prints whole (main, 14 Sep).** Download PDF printed a
  portrait page with the table clipped at the scroll box's edge (a
  scrollbar and all), the orange header and final-score rows dropped so
  the score was white on white, the authenticator banner at the top,
  and the browser's own title/URL lines. Now: a `<style>` on the page
  sets `@page { size: A4 landscape; margin: 0 }` (a zero page margin is
  what suppresses the browser's header and footer lines; `main` carries
  `print:p-[8mm]` instead); the table wrapper is `print:overflow-visible`
  with `print:min-w-0` and smaller print type on its cells; the table
  carries `print:[-webkit-print-color-adjust:exact]` /
  `print:[print-color-adjust:exact]` so its backgrounds print whatever
  the "Background graphics" setting; the shell's MFA grace banner is
  `print:hidden`.
- **Scorecard picker lists the month's team, not today's (main, 14 Sep).**
  Reported by Lea: her Agent dropdown offered one person, and someone
  who left in July was still offered for August and September. The page
  built the list from today's roster (`employees.supervisor_eid` = her
  EID, status active), so a realigned team shrank to whoever is linked
  to her now, and an attrition recorded by EWS tag or masterlist (which
  does not flip `employees.status`) never dropped anyone. Now
  `rosterFor(user, month)`: `reportingScopeIds(user, month)` (whoever
  held each person for most of that month, by assignment history — the
  MBO and Stack Rank rule) filtered by `eligibleForPeriod` (left before
  or too early in the month), with the supervisor of record for the
  month in the dropdown; `getScorecardFor` prints the month's supervisor,
  manager and site (`coalesce` over the period owner, then today's
  roster); `reviewScorecard` checks the same month scope instead of
  `withScope`. An agent is always just themselves.
- **Scorecard build fix (main, 14 Sep).** The first merge of the
  scorecard failed the Vercel build and CI: `scorecard/actions.ts` is a
  `"use server"` module and exported two string constants, which Next
  rejects ("only async functions may be exported"). Typecheck, lint and
  vitest all pass on such a file, so `npm run build` is the check that
  catches it — run it before merging anything that adds a server-action
  module. The constants are now module-private.
- **Scorecard, step 5: the stack rank ranks on it (feature branch,
  14 Sep).** `getStackRanks` now scores the roster with
  `computeScorecards(ids, monthStartOf(period.start))` alongside the
  period KPIs; `RankRow.score` (the month's final score) is the ranking
  key in `rank()` and `rankSupervisors()` (team mean over scored
  members), with the PAR rating kept as a column. The page is monthly
  only (`PeriodPicker` gained `granularities`, hiding the switch when
  one size is offered) over months from the first fact to today, so the
  current month is a running month-to-date ranking; "Your score" out of
  5 against the 3.00 minimum replaces "Your rating". Tests updated
  (`stack-rank.test.ts`, `stack-rank-scope.test.ts` mocks the loader).
- **Scorecard, step 4: the page, the stamps, the migration (feature
  branch, 14 Sep).** `/scorecard` for every role but trainer/SME (who are
  redirected): an agent's own card ("My Scorecard" in their nav), a team
  leader's people, a manager's or admin's span ("Scorecard" after MBO in
  the leader nav; the support filter drops it). `ScorecardPickers`
  (agent + month, URL-driven) over months from the first fact to today,
  so the current month is a running month-to-date card. Loader
  `src/lib/scorecard/load.ts`: `computeScorecards(ids, monthStart)` reads
  the month's skill facts (folded to configured skills through the same
  aliases as PAR; hours = IEX hours where present, productive hours
  otherwise; the target averaged over the month's weeks with ramp
  overrides, `ramping` flagged), quality facts by skill group
  (`score_sum / audits`), the six-month CRITICAL/STANDARD counts from
  `metric_facts`, attendance (`combine("ratio_pct")`), NPS from
  `nps_facts`, and `monthly_metrics` — one round of eight queries for the
  whole set. `getScorecardFor` adds the employee, the review row and its
  names. `ScorecardTable` prints the workbook's layout (weightage,
  metric, actual, rate, goal, the five bands, weightage score, prod
  hours, weight; Total weightage / Raw score / Final score with the 3.00
  minimum). Stamps: `scorecard_reviews` (migration
  `0051_scorecard_reviews` / `APPLY_0051_SCORECARD_REVIEWS.sql`,
  rehearsed twice; run after 0050): `reviewScorecard` — supervisor only,
  own scope, refused before the DB until ten days after the month ends
  (`reviewOpensOn`, `canReview` in `review.ts`, tested), stores the score
  at review and clears any acknowledgement, notifies the agent
  (`scorecard.reviewed`); `acknowledgeScorecard` — agent only, own
  record, needs a review first, once, notifies the linked team leader
  (`scorecard.acknowledged`). Notifications link to
  `/scorecard?month=…[&employee=…]`. A re-import that moves a reviewed
  card shows "Changed since it was reviewed" (`changedSinceReview`,
  0.005 tolerance); the leader's button reads "Review again" and the
  agent's acknowledgement waits for it. Print via the records
  `PrintButton` with `print:hidden` chrome. Authorization tests in
  `scorecard/authorization.test.ts`.
- **Scorecard, step 3: the engine (feature branch, 14 Sep).**
  `src/lib/scorecard/engine.ts` (`computeScorecard`, pure, pinned by
  `engine.test.ts` against the business's own August 2026 card: 4.12)
  and `bands.ts` (the fixed rate tables, `rateOn`, pinned boundary by
  boundary). Weights: Productivity 20, Quality 20 split Ancillary/Phone
  by the month's hour share, Errors 20 split Critical (ancillary) / NPS
  (phone) the same way, Standard Error 10, IRE 10, PKT 10, Attendance 5,
  LH Utilization 5; `MINIMUM_SCORE` 3. Productivity is the PAR rating
  (each skill on its own R1-R5 curve via `computeSkillRating`, weighted
  by hours; `skillBandLabels` prints the sheet's "127.27%-Higher"
  columns). Phone = `skillGroupOf`: metric `aht` or lower-is-better;
  everything else ancillary. Row statuses: `scored`, `defaulted` (IRE 0,
  PKT 100, LH 100 stand in until the Monthly sheet arrives —
  `MONTHLY_DEFAULTS`), `no-weight` (zero hour share: a dash, not a gap),
  `no-data` (weight but nothing measured: dropped, the final score read
  over `weightScored`, `rescaled` true). Critical and Standard Errors
  are six-month counts (the loader's job); a count of 7 rates 1.
- **Scorecard, steps 1-2: the import learns its inputs (feature branch,
  14 Sep).** First slice of the monthly OptumRx scorecard (see the
  scorecard bullets that follow for the engine and pages). Migration
  `0050_scorecard_inputs` / `APPLY_0050_SCORECARD_INPUTS.sql` (rehearsed
  twice on the scratch DB; the generator numbered it 0049 and was
  renamed as usual): `quality_facts.score_sum` (the audits' 0-1 scores
  added up per skill and day, so the mean per skill group is
  `score_sum / audits` — the blended weekly Quality KPI cannot be split
  back into phone and ancillary), a `monthly_metrics` table (one figure
  per employee, month and metric: IRE a count, PKT and LH_UTILIZATION
  percentages; unique on the three; RLS + policy in the APPLY), and a
  `STANDARD_ERRORS` KPI definition (`generates_action_items` false,
  aggregation `sum`) so the Feedback sheet's Standard column can be kept
  as `metric_facts` by date — no weekly row is ever written for it, so
  it appears nowhere a weekly measure would. Import: the Quality case
  adds `scoreSum` to each quality fact; the Feedback case reads a
  `Standard` column (`Standard`, `Standard Error(s)`, `Standard IO`,
  `Standard Count`) as the row's count, falling back to a Compliance
  Risk label that says Standard, and the preview warns when the column
  is missing; a new optional `Monthly` sheet (`MONTHLY_SHEET_ALIASES`:
  Monthly / Monthly Metrics / Monthly Scorecard) is read outside the
  weekly loop — a Month column (`parseMonthLabel`: 2026-09, 09/2026,
  9/1/2026, Sep-2026, September 2026, a date cell) instead of Weekly,
  either one column per metric (IRE, PKT, LH Utilization) or a Metric /
  Value pair, percentages typed as 82.38 or as the Excel fraction
  0.8238, last row wins per employee-month-metric, its own skipped-row
  issues, and no warning when absent from a weekly file. The template
  gains the Monthly sheet (`TEMPLATE_MONTHLY`), `commitImport` upserts
  `monthly_metrics` and reports `monthlyMetricsWritten`. Backfill: after
  this deploys, re-upload the last six monthly workbooks (April to
  September 2026) once so `score_sum` and the Standard counts exist for
  the scorecard's windows; the upserts replace, never duplicate.
- **Support queue wording (main, 14 Sep).** Post-deploy audit of the
  support queue: the next step read "Training and Coaching requested"
  with a capital mid-sentence (now built lower-case and capitalised
  once), and the headline card's hint said "N open items" when the
  queue counts only items asking for support (now "N items asking for
  support"; "open items" on the every-item view).
- **Trainer and SME Development Hub is a support queue (feature branch,
  14 Sep).** Asked after the audit: a support role reads the whole floor,
  where "most blocked first" put hundreds of root causes that are the
  team leaders' to write at the top. `boardReaderFor(user)` names three
  readers (leader, agent, support); `getDevelopmentBoard(user,
  {everyItem})` opens a support role on the items whose action plan
  marks coaching or training required (`supportRequested`; the flags
  and `employees.supervisorName` now ride on `ActionItemListRow`), with
  "Every open item" one click away (`?scope=floor`, composable with
  `?all=1` via `hubHref`). Their rows sort by KPI, then team leader,
  then name (`byKpiThenLeader`; a person with two KPIs sits under the
  first alphabetically), with a Team leader column and cards for Needs
  training / Needs coaching / In monitoring / Nearing close; the next
  step reads "Training requested · monitoring (1/4)"
  (`assessForSupport`). `buildDevelopmentBoard` is the pure grouping
  and is tested. One owner per record: `canRewriteRecord` in
  `src/lib/development/support.ts` lets a support role write an RCA or
  plan where none exists and edit their own, but someone else's RCA is
  read-only to them (server refuses with `SUPPORT_RCA_LOCKED`; the page
  says to add a note) and on someone else's plan only the coaching and
  training flags are applied (`action_plan.support_flags_updated`; the
  form's `flagsOnly` mode shows the plan as a record with just the two
  checkboxes). Leaders and admins are unchanged. Performance left as
  is: one select with a handful of joins over a few hundred rows.
- **Development plan audit follow-ups (feature branch, 14 Sep).** The
  rest of what the audit found, none of it a data change:
  - *Development Hub totals are no longer capped.* `getDevelopmentBoard`
    asked `getActionItems` for at most 1,000 open items and summed the
    rows into the stat cards, so a whole-floor board (admin, trainer,
    SME) undercounted silently past that. `listActionItems` now takes
    `limit: null` (the query is built with `$dynamic()` so the limit is
    optional) and the board passes it; the page still renders 20 rows.
  - *A completed item is a closed record.* `saveRca` and
    `saveActionPlan` refuse on `COMPLETED` (`closedRecordError`: "This
    item is completed, so its record can no longer be changed") and the
    page renders both forms read-only with "Closed with the item" as the
    subtitle. Notes stay allowed (append-only; a correction is another
    note) and so does Time & Motion.
  - *Reopened items say what they need.* A banner on the action-item
    page (worded for the agent, the supervisor and a manager) explains
    that passing weeks are logged but not counted until the plan is sent
    again and acknowledged; the button reads "Send to agent again"; the
    timeline says "opened the item" on the opening fail and "passed
    before the plan was acknowledged — not counted" on a zero-count
    pass (the Records print view too); the Hub's next step reads
    "Reopened — update the plan and send it to the agent again".
  - *The agent's Hub speaks to the agent.* `assess(items, forAgent)` in
    `development.ts` (now exported and tested in `development.test.ts`)
    phrases the next step as whose move it is ("Your supervisor is
    recording the root cause", "Acknowledge your plan"); the stat cards
    and the next-step colour only alarm on the agent's own step.
  - *Note weeks are checked on the server.* `addRcaNote` accepts only a
    week in the item's `weekly_issue_history` or its opening week ("Pick
    one of the weeks this item was evaluated"); the form already offered
    only those.
  - *Time & Motion segments cap at four hours with a real message*
    (was 3,600 s with zod's default wording).
  - *Authorization tests* now cover `saveRca`, `saveActionPlan`,
    `sendToAgent` and `acknowledge` (role gate, signed-out, pending,
    malformed input before any database access, and the scope check
    being reached) alongside the existing notes and Time & Motion ones.
  - *Dead code removed:* `isDevelopmentItemStale` and
    `SUSTAINED_PASS_WEEKS` with their test file.
- **Age-out counts from the last failure, not the opening week (main,
  14 Sep).** Found by a functionality audit of the Development plan.
  `shouldAgeOut` measured the 60 days from `openedWeek` and only asked
  whether the latest week passed, so an item older than 60 days that had
  just relapsed closed as "recovered and past age threshold" after one
  passing week, and the next failing week opened a second item for the
  same problem (reproduced with the engine: opened June, reopened
  10 Aug, one pass, closed). The engine now takes `lastFailedWeek` (the
  pair's most recent failing weekly result; `ageOutRecoveredIssues`
  tracks it in the same scan as `latestResult`) and measures from the
  later of that and the opening week; the age-out audit entry records it.
  Pinned in `engine.test.ts`.
- **Acknowledging an item no longer notifies every supervisor (main,
  14 Sep).** Same audit: `acknowledge` built its recipient filter as
  `and(role = supervisor, supervisorEid ? eq(...) : undefined)`, so for
  an employee with no supervisor EID on record the second clause fell
  away and the whole supervisor role was notified. Now nobody is when no
  supervisor is linked.
- **Left sidebar replaces the top nav (15 Sep, feature branch).** From
  the revised My Space handoff, whose real trigger was the chrome: the
  single-row header's dozen tabs had outgrown one line. `AppSidebar`
  (`src/components/app-sidebar.tsx`, server: the same data fetch and the
  same per-role nav composition the header had) renders `SidebarShell`
  (client): brand mark + "LEOU EMR / Command Center" on top, every
  destination stacked (`SidebarNav`, the old NavTabs' active and pending
  states in a column; active = orange fill, navy text), and at the foot
  the person (the ProfilePanel trigger, now a row: avatar always, name and
  role only while expanded), Inbox with the unread badge beside Sign out
  (`SignOutButton tone="sidebar"`), and a ‹/› toggle that folds the rail
  to 64px. The folded state is a cookie (`sidebar=collapsed`,
  `SIDEBAR_COOKIE`) rather than the handoff's localStorage so the layout
  renders it folded from the server and nothing snaps shut on load; when
  folded, labels truncate with a title tooltip and the unread count stays
  as one orange strip. Below `md` the rail is a drawer: a slim bar (brand
  + Menu with the unread count) opens it over the page, the backdrop,
  Escape or navigating closes it (the drawer remembers the path it opened
  on, so a new path closes it with no effect — the React Compiler lint
  refuses a setState in an effect). The shell layout is now
  `flex-col md:flex-row` with the page in its own `min-w-0` column; the
  MFA grace banner and the navigation progress bar sit at the top of that
  column, the bar in a `sticky top-0` wrapper since there is no sticky
  header to hang under any more. Pages are untouched: `PageBand` and
  `max-w-7xl mx-auto` centre within the page column. Sticky offsets that
  assumed the 96px header dropped to `top-6` (the audit form's aside, the
  My Space rail); table headers stick inside their own scroll boxes and
  needed nothing. Retired: `app-header.tsx`, `nav-tabs.tsx` and
  `header-scene.tsx` (the header's astronaut scene had no home left; the
  `hdr-*` keyframes stay, the My Space rail uses them, and the figure
  itself lives on as `astronaut-figure.tsx`). Print hides the rail and
  the bar. Smoke-rendered expanded and folded with a stubbed app router
  and pathname (one active link, badge, toggle labels).
- **My Space (15 Sep, feature branch).** A leader's personal daily
  board at `/my-space`, from the supplied design (My Space.dc.html +
  handoff README): four boxes — To Dos, Decisions, Ideas, Let Go — with
  add (Enter or the button, optional note behind "+ note"), a checkbox
  on every box but Ideas, in-place edit (empty text cancels), delete
  without confirmation; "Save day" archives the board as today's
  snapshot (Manila's today, `todayInManila`) and clears it, with a toast;
  "History" slides in a panel with a month calendar marking saved days,
  the same days as a list with a "X done · Y decided · Z ideas · W let
  go" summary, and the picked day read-only beneath. The progress rail
  stacks the header's planets, one per box, filling as that box's
  percentage climbs (complete ÷ total for the three checkbox boxes, count
  ÷ `IDEAS_DAILY_GOAL` (5) for ideas, overall the plain average), with
  the astronaut walking the line between them as far as the overall
  figure has come. Who: every role but the agent (`canUseMySpace`) — the
  brief named team leaders, managers and trainer/SME; an administrator
  has it too, as they have every page. Private to the account: both
  tables carry `user_id` and every read and write is scoped by it, so
  nobody's reporting scope reaches another leader's board. Storage:
  migration 0053 (`drizzle/0053_my_space.sql`, one-paste
  `APPLY_0053_MY_SPACE.sql`, rehearsed twice on the scratch database):
  enum `my_space_box`, `my_space_items` (the live board) and
  `my_space_days` (jsonb snapshot, unique per user and day — saving twice
  on one day replaces). Code: pure parts in `src/lib/my-space/board.ts`
  (box meta, percentages, rail geometry, calendar cells, snapshot parse,
  role check; tested), the read in `src/lib/queries/my-space.ts`, the
  five actions in `my-space/actions.ts` (agent refused before any read,
  text ≤ 500 / note ≤ 300, an idea cannot be toggled, "Save day" refuses
  an empty board and deletes only the items it snapshotted, so one added
  mid-save survives; authorization tests), and the client in
  `my-space-board.tsx` (ticks and deletes are optimistic and undone on
  refusal; adds and edits wait for the server; errors are a fail-tone
  toast). The astronaut figure is now a shared component
  (`src/components/astronaut-figure.tsx`) used by the rail; the header
  scene keeps its own copy with the syringe arm, untouched. Nav: "My
  Space" after Records for every non-agent role. Departures from the
  brief, on purpose: the 2×2 grid collapses to one column below `md`
  (the handoff flagged mobile as unresolved), and the board persists
  server-side instead of localStorage (the handoff asked for exactly
  that). Not audited: private notes, not a record.
- **Approving an account confirms its email address (14 Sep, feature
  branch).** People approved on the Users page were still refused at
  sign-in with "Confirm your email using the link we sent you": company
  mailboxes filter Supabase's confirmation email, and its built-in mailer
  sends only a few per hour, so the link often never arrived. Approval is
  the stronger check anyway (an administrator vouching for a named
  colleague on the roster, where the link only proves the mailbox was
  reachable), so both approval paths in `users/actions.ts` now also mark
  the address confirmed through the service-role admin API
  (`confirmEmail`: `auth.admin.updateUserById(id, { email_confirm: true })`).
  Only a pending → active transition counts: a save that keeps the
  account pending, or re-enables a disabled one, never touches the
  address. Best effort: a refusal from Supabase leaves the approval
  standing (the emailed link still works) and is reported — the row save
  returns `warning` and shows it under the name, the bulk button returns
  `unconfirmed` and says how many; each `user.updated` (on approval) and
  `user.approved` audit row carries `emailConfirmed`. The bulk path calls
  the API ten at a time (`confirmEmails`). The confirmation email still
  goes out, so whoever's mailbox works confirms themselves first, and the
  operator step from the earlier note stands: Custom SMTP in Supabase
  (the Brevo relay the EOD report already uses) lifts the hourly cap.
  Tests fake the admin client and extend the in-memory `db` with
  `returning()` and `and`/`ne`/`inArray` predicates so the bulk approval
  runs end to end.
- **A team leader's account row can be saved again (13 Sep).** Setting
  Lea's cluster link on the Users page was refused with "No employee
  found with ID …": `updateUser` re-checked the employee ID against agent
  rows on every save, whether or not the ID had changed, and a team
  leader's ID is never an agent row — the workbook lists agents only, so
  a leader exists in the data solely as the `supervisor_eid` on their
  reports' rows. Every row edit for every team leader failed the same
  way. Now only a *changed* ID is checked, and the check
  (`eidKnownToRoster`) accepts an agent's own row, a current
  `employees.supervisor_eid`, or one in `employee_assignments`. The
  page's red hint follows the same rule and reads "Not on the roster".
  Found while diagnosing Lea's empty November cluster: her account had no
  link and no rostered team, so the cluster fell back to her last-known
  manager (Tuting) while Archiene's team sits under Comendador — the
  data, not the code; the link is the remedy until her team is rostered.
- **Second step at sign-in (authenticator app), feature branch 12 Sep.**
  Supabase Auth TOTP (free plan; must be enabled under Authentication >
  Multi-Factor). Rules in `src/lib/auth/mfa.ts` (tested): admin, manager
  and supervisor sessions must carry assurance level `aal2`; agents may
  enrol. Enforced three ways that agree: the middleware redirects to
  `/mfa` from the token alone (`aal` claim + `app_metadata.role`, which
  `updateUser` copies on every role save and `npm run sync:auth-roles`
  copies for existing accounts — without the claim the middleware does
  nothing and the next two layers hold); the shell layout redirects from
  the users table's role and the `x-session-aal` header the middleware
  sets; and `getCurrentUser` returns null for a *server action* request
  (`x-request-kind: action`, from the `Next-Action` header) whose session
  owes the step, so a password-only session cannot act even by calling
  actions directly. Pages that get someone to the step are exempt
  (`MFA_EXEMPT_PREFIXES`: /mfa, /login, /auth, /pending,
  /reset-password). `MFA_GRACE_UNTIL=YYYY-MM-DD` turns "enrol" into a
  reminder banner until that date. `/mfa` (src/app/mfa) does enrol,
  challenge and verify in the browser client, clearing a half-finished
  enrolment first; the header's Security link reaches it. The Users page
  reads `auth.mfa_factors` in one query for the Authenticator column and
  offers `resetMfa` (admin client `auth.admin.mfa.deleteFactor`, audit
  `user.mfa_reset`) for a lost phone. Sign-out is the browser client, so
  a session stuck at the code prompt can always sign out. Live since the
  12 Sep merge (production 22:11 UTC): TOTP enabled in Supabase,
  `sync:auth-roles` run (it needs `SUPABASE_SERVICE_ROLE_KEY` in
  `.env.local`; a duplicate empty line of that variable lower in the file
  had been overriding the real one), `MFA_GRACE_UNTIL=2026-09-19` set in
  Vercel so required roles see the banner until then, and the
  administrator's own authenticator paired the same night.
- **Email links land on a button, not an automatic exchange (12 Sep).**
  `/auth/confirm` was a route handler that spent the one-time token on
  GET. Corporate mail security (the team is on Optum mail) opens every
  link to scan it, so the token was gone before the person clicked and
  Supabase logged "One-time token not found" on `/verify`. It is now a
  page (`src/app/auth/confirm/page.tsx`) with a Continue button whose
  server action (`confirmLink` in actions.ts) does the `verifyOtp`; a
  plain visit spends nothing. Same URL shape as before, so the Supabase
  templates are unchanged. `isConfirmType` and `confirmDestination`
  (src/lib/auth/confirm-destination.ts) are the pure parts.
- **Password reset exists (12 Sep).** The login page had no way to
  recover a forgotten password; an administrator had to reset it in the
  Supabase dashboard. "Forgot your password?" on the sign-in form now
  calls `resetPasswordForEmail` and shows the same notice whether or not
  the address is registered. The link in the email goes through
  `/auth/confirm` with `type=recovery` (`confirmDestination` sends it to
  `/reset-password`; every other type still lands on `/pending`), which
  signs the person in only to choose a new password; the same page serves
  anyone signed in who wants to change theirs. `MIN_PASSWORD_LENGTH` (12,
  `src/lib/auth/password.ts`) applies on the sign-up and reset forms;
  Supabase's own floor and leaked-password check still apply at the
  server. Operator step: the "Reset password" email template in Supabase
  must link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`,
  the same shape the "Confirm signup" template already uses.
- **Security hardening (12 Sep, feature branch).** Four edges closed
  after a review of the whole app. (1) The end-of-day report
  (`my-stats/actions.ts`) relays through a mailbox the app holds
  credentials for, so its recipient is now restricted
  (`recipientAllowed` in `src/lib/mail/recipients.ts`): the sender's
  current supervisor's or manager's account address always, otherwise
  an address on `MAIL_ALLOWED_DOMAINS`, or with that unset the sender's
  own domain — public providers (`PUBLIC_MAIL_DOMAINS`: gmail.com and
  the like) never count as a company domain either way, since accounts
  here may well be on Gmail; at most `EOD_DAILY_LIMIT` (10) sends per account per UTC
  day, counted off `audit_log` rows `eod.sent` that every send now
  writes; body, text, CSV and attachment name are size- and
  shape-capped. (2) Sign-up: `SIGNUP_EMAIL_DOMAINS` limits new accounts
  to company domains, enforced in `checkSignupAvailability` (the page
  calls it before `supabase.auth.signUp`; the database trigger still
  creates any account as pending, so a bypass gains nothing), and every
  clash now returns one generic `SIGNUP_TAKEN_MESSAGE` so the form no
  longer confirms which email, EID or MSID is registered. (3) The login
  page follows its `next` parameter only to a same-site path
  (`safeReturnPath`). (4) `next.config.ts` sends a Content-Security-Policy
  and the usual headers on production builds only; the policy allows
  inline scripts and styles (Next renders them without nonces) but pins
  script, worker and connect sources to this site, Supabase, and the two
  hosts the OCR engine needs (`cdn.jsdelivr.net` for the script, worker
  and wasm, `tessdata.projectnaptha.com` for language data); preview
  deployments also allow Vercel's toolbar. If a feature ever loads from
  a new host, add it there or the browser blocks it silently (check the
  console). Mailbox, Supabase Auth settings (password length,
  leaked-password check, MFA), a limited database role and backups are
  operator steps outside the code; the domain lists stay unset until the
  administrator names the company domains. Done on 12 Sep after the merge
  (production 19:44 UTC): a dedicated Gmail account is the sender
  identity for both the end-of-day report (Vercel `EOD_SMTP_*`) and
  Supabase Auth's own emails (custom SMTP on, send limit raised to 30/h;
  sign-in and token-refresh limits raised for a floor that shares one
  IP). Gmail itself refused SMTP from Supabase's servers for the
  brand-new account (534 "log in with your web browser", and Google has
  retired the DisplayUnlockCaptcha override), so the mail server is
  Brevo's free relay (300/day, adds a small Brevo line to each email):
  host `smtp-relay.brevo.com`, port 587, login is the generated
  `…@smtp-brevo.com` address on Brevo's SMTP tab (not the account
  email; 535 otherwise), password an `xsmtpsib-` SMTP key, and Brevo's
  Security → Authorized IPs restriction deactivated for SMTP keys (525
  "Unauthorized IP address" otherwise). The Gmail address is the
  verified Brevo sender. First successful reset email 12 Sep 20:39 UTC.
  The administrator's personal Gmail, which carried the first EOD sends
  through an app password, is out of the picture: that app password was
  revoked 13 Sep, so no credential of a personal account remains in
  Vercel, Supabase or Brevo.
  Supabase Auth: minimum password 12 with letters and digits
  (leaked-password protection is Pro-only). Still open: MFA, the
  limited database role, the weekly backup.
- **An episode's opening week counts as a recorded failure, row or no
  row.** The Sep 10 fix (`loadFoldedResults`) stopped a re-import from
  opening a second episode for a failure a closed episode had recorded,
  but it read only `weekly_issue_history`, and episodes opened by earlier
  versions of the engine have no history row for the week they opened on
  (that insert in `applyOpens` dates from 7 Sep). Re-importing such a week
  found nothing folded and opened a duplicate all the same — the 12 Sep
  dedupe report listed dozens opened on 16 May duplicating episodes from
  the same week. `loadFoldedResults` now also seeds every episode's
  `opened_week` as a failure (a recorded result outranks it), and
  `dedupe:episodes` seeds its history map the same way, so it catches the
  duplicates of such episodes too. A one-off repair inserting the missing
  opening rows is optional (the page timeline is the only reader that
  would notice); the engine no longer depends on them.
- **The employee page lists every week the ledger has for the person,
  and a thin skill week is shown but not judged.** `getEmployeeMatrix`
  used to take its week list from scorecard rows only (`PLAN_KPI_CODES`),
  so a week that so far had only skill results — the September backfill
  wrote skill rows for a week no full workbook had covered — was missing
  from the plan, the item timeline and the skill breakdown, while an item
  opened on it pointed at a week the page did not show. The week list now
  comes from every ledger row; the grid is still filtered to the
  scorecard in code. And `SkillWeekCell.judged` (skill-breakdown.ts, via
  `measureSkillWeek`) carries the engine's own rule — under
  `MIN_SKILL_HOURS` on an hours-based skill, no result and no item — so
  the breakdown draws such a week muted with a hover note instead of red,
  which had read as a failure with no development item behind it.
- **Every skill roll-up folds a skill's spellings before measuring.**
  Follow-up to the breakdown fix below, across the rest of the readers of
  `skill_facts`: `foldSkillRows` in `src/lib/kpi-engine/skill-result.ts`
  (tested) sums rows that resolve to the same reference — the first row's
  label, week and targets stand for the fold, unresolved rows come back
  for reporting — and is applied in `computeParMetrics` (import-time PAR,
  per-skill KPI rows and case rate per employee-week), `getPeriodMetrics`
  (the same over a period) and `getMboAttainmentBySkill`. Rated apart,
  one skill scored twice in the production rate with its volume split,
  wrote two results onto its own KPI for the week (the ledger's unique
  key kept whichever came last) and counted as two skills in the MBO
  tree. The supervisor skill breakdown already keyed on the reference
  code, and the case-rate blends (my-stats, trend) sum cases and weight
  against one per-case target, so a split changes nothing there. Weekly
  ledger rows written before this for an employee-week that carried two
  spellings of one skill stay as computed until those weeks are
  re-imported; period figures rebuild from the facts on the next read.
  Checked on 12 Sep: only Fax was affected, 21 employee-weeks in the
  weeks of 28 Mar to 25 Apr 2026. The administrator chose not to
  re-import those weeks — their weekly PAR, Fax and case-rate rows stand
  as first computed, and nothing else needs doing.
- **The employee page's skill breakdown is one row per configured skill.**
  `getEmployeeSkillBreakdown` used to group `skill_facts` by the raw label
  and only then resolve each group to its reference, so a source file that
  wrote the same skill two ways across weeks ("Fax" through 1 May, another
  spelling from 2 May) gave one agent's page two rows both named Fax with
  the history split between them at the change. `groupSkillFacts` in
  skill-breakdown.ts (tested) resolves first and keys on the reference
  code, as the supervisor and MBO roll-ups already did; the ramp override
  is looked up by the reference code, which every override is keyed under.
- **A team leader's cluster can be set on their account.** The Users
  page's manager field (`users.manager_name`, kept by `updateUser` for
  supervisor accounts as well as managers; "Manager span / cluster") names
  the cluster a team leader belongs to. `clusterManagerFor` consults it
  only for a month the roster gives them no team, before the last-known
  manager from their reports' history; once their reports are on the
  roster, the roster's manager of record is the cluster and the link is
  not read. Came from a team leader moved to a new cluster before her
  September team was rostered: her cluster resolved to the manager her
  August reports sat under, so a peer leader's November leave in the new
  cluster never showed. The approval chain follows the same rule:
  `managerNameFor` answers with the link when the leader has no current
  reports (a split team still resolves to nobody, link or not), so the
  linked manager can approve and cancel their leave, and
  `decidableLeaderIds` adds linked leaders without reports to the
  manager's queue. A manager's Team leaders view needs no link — it is
  the manager's own span.
- **Month arrows keep the calendar view, and leaders always file as
  leaders.** The Previous/Next links on the leave calendar carry the `view`
  parameter (`monthHref` in pto/calendar.tsx), so stepping a month no longer
  drops a manager back to Everyone or a team leader to My team. The
  month's request query is never skipped for a month with no agents in
  scope: your own request, and the other leaders' in a leaders-only view,
  still belong on it. And `requestPto` files a supervisor's or manager's
  leave against their account (`employeeId` null) even when an employee row
  carries their EID — a working team leader the roster also lists — since
  a leader's leave is decided a level up and read on the leaders'
  calendars, not as one more agent's. A request such a leader filed
  before this was stored as an agent request; setting its `employee_id`
  to null moves it to the leaders' calendars.
- **The leave calendar shows the team as it stood in the viewed month.**
  `ptoViewIds(user, view, period)`, `hasCluster(user, period)` and
  `leaderAccountsOver(ids, period)` in `src/lib/pto/scope.ts` all take the
  calendar's month and resolve people through the structure of record
  (`reportingScopeIds`, `periodOwnerSubquery`), the same rule as the
  dashboard's period cards. A team leader whose team has since moved on
  still sees June's leave on June's calendar, and the "My team / My
  cluster" switch follows the month's team. "My cluster" draws only the
  team leaders under the same manager (their own leave), never the other
  teams' agents — the page empties `agentIds` for it, as for a manager's
  "Team leaders" view, while the cluster's agent ids still decide which
  leaders are found. A team leader with no team in the viewed month still
  gets a cluster: `lastKnownManagerFor` takes the manager of their latest
  stint in the history, so the switch stays while they are between teams. Who a leader may *decide* for
  (`decidableIds`, `decidableLeaderIds`) stays on the current structure —
  a wider or older view never widens authority. Agents and admins keep
  their current-team calendar.
- **A leader can cancel the leave of the people they decide for.**
  `cancelPto` lets the requester withdraw their own request and lets a
  leader cancel a pending or approved request for anyone they could
  approve — the same authority check as `decidePto` (`resolveScopedIds`
  for an agent's request, `canDecideForLeader` for a leader's own), so
  cancelling never reaches further than approving; the audit row records
  `by: requester | leader`. On `/pto` a leader gets a Cancel beside
  Approve/Deny in the pending queue and an "Approved leave ahead" card
  (approved, ending today or later, for the people they decide for) with
  a Cancel per row.
- **A manager's own leave is approved on submission.**
  `approvedOnSubmission(role)` in `src/lib/pto/rules.ts` (managers only):
  `requestPto` inserts the request as `approved` with `decidedAt` set,
  `decidedBy` null (nobody decided it) and a decision note saying why,
  audits it as `pto.requested_and_approved`, and returns `approved: true`
  so the form says it is on the calendar rather than awaiting review. An
  agent's request still waits for their team leader and a team leader's
  for their manager; an administrator's own request still waits for
  another administrator.
- **A manager's leave calendar has three views.** `/pto?view=` for a
  manager is `everyone` (default), `agents` (the span's agents only) or
  `leaders` (the team leaders' own leave only); a supervisor keeps `team`
  and `cluster`. `calendarViewFor(role, requested)` in
  `src/lib/pto/scope.ts` is the one resolver, and `ViewPicker` takes its
  tabs (`MANAGER_TABS` / `SUPERVISOR_TABS`). The split is done on the
  calendar read only: `agentIds` is emptied for the leaders view and
  `leaderVisibleIds` reduced to the viewer for the agents view; the
  pending queue below is unchanged.
- **Time Off cluster view uses the majority manager.** The "My team / My
  cluster" switch on `/pto` is offered to a supervisor whose reports mostly
  sit under one manager (`clusterManagerFor` → `majorityName` in
  `src/lib/pto/scope.ts`); it used to require every report's row to carry
  exactly the same manager name, so one roster miss or a name written two
  ways hid the switch. Approval authority (`managerNameFor`,
  `canDecideForLeader`, `decidableLeaderIds`) keeps the strict
  single-manager rule on purpose. Managers never get the switch: their team
  is the cluster. All of these count only *current* reports — employees
  with an open assignment interval (`currentlyAssigned`) — because a
  masterlist that closes someone as attrited never rewrites their employee
  row, which keeps naming their last supervisor and manager; those stale
  rows had put one supervisor under three managers at once. Verified live
  on 2026-09-11: every supervisor's extra manager rows were attrited
  people. The stale rows themselves are the wider "218 still active"
  issue: the Employees page and an agent's leave calendar still list them.
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
- **Query gate on the db client (2026-09-10 UTC).** `withQueryGate` in
  `src/lib/db/query-gate.ts`, wired in `client.ts`; unit-tested against a
  fake postgres-js query, and checked live against a local Postgres 16
  (pool of 2, twelve concurrent queries plus a transaction: all correct,
  peak of 2 active sessions). See the incident below for why.
- **Group breakdowns with no reporting week in the range (2026-09-10 UTC).**
  `computeAnalytics`'s by-site/manager/supervisor join was unbounded when
  no week started inside the range, so a month with daily facts but no
  weekly ledger yet (weeks are keyed by their Saturday start) showed
  all-time failure counts on every manager-dashboard row beside a summary
  saying nobody had data. Now such a range reports nobody evaluated, and
  the row's Failing header says "no reporting week in this period yet".
  Verified live on September 2026 (every row "— · nobody evaluated";
  team, MBO pass and open counts still real). The column fills in by
  itself once the first week starting inside the month is imported —
  for September 2026 that is the week of Saturday 5 September.
- **Weekly import overriding the masterlist month (2026-09-11 UTC).**
  Symptom: a supervisor's September team read 35 on the manager
  dashboard when the roster just uploaded gave her 20, and the 218
  people the masterlist had closed were active again. Cause: the
  September masterlist (open-ended 1 Sep interval per listed person) was
  committed first, then the week of 29 Aug–4 Sep; `spliceAssignments`'
  subtract step drops the tail of any open-ended interval the file's
  window overlaps, so the weekly file cut the masterlist month out, put
  its own (stale) supervisor column back for all of September, and
  reopened the attrited. Fix: `spliceWeeklyAssignments` (see the org
  history bullet above), commit 09eb792. The data itself is repaired by
  re-uploading the September masterlist after that deploy: its splice
  cuts the weekly file's open intervals at 31 Aug and its attrition pass
  re-closes the 218. Second cause, found from a team leader's "My team"
  reading 4 while no September assignment carried her name: the period
  owner's per-field fallback to the `employees` snapshot handed everyone
  with no September assignment — the attrited included — to the
  supervisor their current row still named, on both the manager
  dashboard's by-supervisor rows and the supervisor's own view, and
  `eligibleForPeriod` knew nothing of masterlist attrition. Fixed by the
  `closed` owner row and the assignment-closure separation date (org
  history bullet above). Check afterwards with the per-supervisor count
  query in the session notes (Herbias should read 20). Third cause,
  after the re-upload put the counts right: every agent on one
  realigned team opened as a 404 from the manager's dashboard, because
  the masterlist never updated the `employees` snapshot the page's scope
  reads — fixed by `syncEmployeeSnapshots` (org history bullet); the
  data itself was repaired by one UPDATE of `employees` from each
  person's open interval, the same statement the sync runs (427 rows,
  all on supervisor_eid: the weekly file and the masterlist disagreed on
  supervisor EIDs and the masterlist's won). Checked afterwards: every
  supervisor EID in the roster with an account resolves to it; the one
  team-leader account with no agents (Lea Fernandez, 001305110) is
  correct — she is not on the September roster because she has no team
  yet. When she gets one, the masterlist must list her agents under that
  EID, since it is what her account matches on.

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

## Incident: manager dashboard "Something went wrong" (2026-09-10 UTC)

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
- **Outcome.** Query gate deployed 2026-09-10 20:16 UTC (`fad27ba`);
  the manager confirmed the dashboard loads, with every granularity and
  period switch returning 200 (Year 6.0 s and Quarter 2.1 s on first
  view — cold aggregations over the whole history — then cached). The
  group-breakdown fix followed at 20:30 UTC (`3a66793`). Times in the
  Vercel log are shown in the browser's local time (PHT, UTC+8): the
  "Sep 11 03:48" entries were 2026-09-10 19:48 UTC.
- **Reading the evidence, next time.** In the Vercel Logs page, tick
  "Error" under "Contains Console Level" to see function-side errors; a
  hang produces none. Middleware rows carry `m`, function rows `f`; a
  request whose function never answered is an `m`-only row with status
  `---`. `f`-only rows for `/dashboard` are prefetches of the header
  logo `<Link href="/dashboard">` (prefetch requests skip the middleware
  by the matcher's `missing` headers), and their 0.1–1.1 kB `_rsc`
  responses are the loading skeleton — normal, not a symptom. A React
  production error number is decoded locally: grep
  `formatProdErrorMessage(N)` in the production bundle under
  `node_modules/next/dist/compiled/react-server-dom-turbopack/cjs/` (or
  `react-dom/cjs/`) and read the same line in the `.development.js`
  file beside it; `react.dev` is blocked by the egress proxy.
- **Statement timeouts, resolved.** The user had run
  `ALTER ROLE postgres SET statement_timeout = '60s'` by mistake and
  then `RESET` it. `select rolname, rolconfig from pg_roles where
  rolconfig is not null;` afterwards shows Supabase's stock values —
  `authenticated` 8s, `anon` 3s, `authenticator` 8s — and the
  `postgres` role with only its search path, which is Supabase's
  default state for it. The app sets no timeout of its own (nothing in
  the repo mentions `statement_timeout`), so the Sep 9 "canceling
  statement due to statement timeout" errors came from a database-wide
  setting the reset could not touch; nothing was lost. `show
  statement_timeout;` in the SQL editor shows the effective value. A
  statement timeout would not have rescued this incident anyway — a
  pipelined query is not a running statement — but it is the only thing
  that bounds a genuinely slow one.

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

What the remote environment does offer:

- A local PostgreSQL 16 cluster (`pg_ctlcluster 16 main start`, then
  `su postgres -c psql` to create a role and database). Good for
  driver-level checks — the query gate was proven against it with a
  pool of two, twelve concurrent queries and a transaction — never a
  stand-in for the app's data.
- The public GitHub API without a token: `actions/runs?head_sha=<sha>`
  for CI and `deployments?sha=<sha>` plus each deployment's
  `statuses_url` for Vercel's Production/Preview state. A 20-second
  poll loop over those two is how every deploy in these notes was
  confirmed; production has taken 2–4 minutes from push to `success`.
- Chromium and Playwright are installed, but nothing here can sign in:
  the person has to log in themselves in a browser pane, and that
  session does not survive a context reset.

## Local development gotchas

- `npm ci` fails behind a proxy that blocks `cdn.sheetjs.com` (the `xlsx`
  tarball). For local typecheck/lint/tests only, temporarily point `xlsx`
  at `0.18.5` from the npm registry, `npm install --no-package-lock`, then
  `git checkout package.json package-lock.json`. Never commit that change.
- `tsc --noEmit` needs `npx next typegen` first (route types), or it fails
  on `LayoutProps`. CI avoids this by running `next build` last.
- postgres-js internals worth knowing before touching `client.ts`:
  `max_pipeline: 0` is not a way to disable pipelining — a transaction's
  `onexecute` callback only fires on the pipelining branch of
  `execute()`, so with 0 the BEGIN's connection is never reserved and
  `begin()` breaks. Concurrency has to be capped from outside, which is
  what `withQueryGate` does (it swaps the query's `handler` on the
  instance; the query calls it once, asynchronously, on its first
  `then`/`execute`).
- Tests that need a fake postgres-js query: subclass `Promise`, set
  `static get [Symbol.species]() { return Promise }`, and call the
  handler from an overridden `then` — see `query-gate.test.ts`.

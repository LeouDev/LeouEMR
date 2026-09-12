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
- **Security hardening (12 Sep, feature branch).** Four edges closed
  after a review of the whole app. (1) The end-of-day report
  (`my-stats/actions.ts`) relays through a mailbox the app holds
  credentials for, so its recipient is now restricted
  (`recipientAllowed` in `src/lib/mail/recipients.ts`): the sender's
  current supervisor's or manager's account address always, otherwise
  an address on `MAIL_ALLOWED_DOMAINS`, or with that unset the sender's
  own domain; at most `EOD_DAILY_LIMIT` (10) sends per account per UTC
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
  administrator names the company domains.
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

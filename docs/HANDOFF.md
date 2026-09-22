# Handoff for a new session

Read this first, then `docs/performance-notes.md` (the project's memory,
one bullet per change, newest inserted at the top of the "already
fixed" run — search for "A team leader's account row" to find the seam).
`AGENTS.md` at the root applies: this is Next.js 16, not the one in
training data; read the guide under `node_modules/next/dist/docs/` before
writing any Next code.

## What this is

The **EMR Performance Command Center** for an OptumRx prior-authorisation
BPO team: imports the weekly performance workbook, evaluates KPIs against
thresholds, opens and tracks development action items, and carries the
team's monthly scorecard, quality audits, leave, EWS, ramp targets, MBO,
stack rank and a leader's daily board. Next.js 16 / React 19 /
TypeScript, Tailwind v4 tokens ("Modernist Navy": navy ground, orange
accent, Archivo, 2px rules, zero radius), Drizzle ORM on Supabase
Postgres through the transaction pooler, Supabase Auth, Vercel Hobby
(region `bom1`), Supabase Free. Repository `LeouDev/LeouEMR`, production
at `prior-auth-emr.vercel.app`, Supabase project "OptumRx EMR".

**This is live data for a real team.** The owner (the admin account,
galileouuu@gmail.com) works with you in real time and sends screenshots.

## The owner's standing rules (verbatim in spirit; do not relax them)

- No destructive operations. No schema change except through the app's
  own Drizzle migration system (`drizzle-kit generate`, a numbered file
  under `drizzle/`, an apply script the owner pastes). Confirm before
  anything that writes to production data.
- Never type a password anywhere. If sign-in is needed, ask the owner
  to sign in themselves in the browser pane.
- Git: new features on the feature branch and merged only on an explicit
  **"merge and deploy"** from the owner; confirmed bugs go straight to
  `main`. Typecheck, lint, the full test suite and a production build
  must pass before any commit.
- Every commit ends with the two trailers below. Never put a model
  identifier in code, commit titles or comments.

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CQCNdPddDQiGF27gG5VtBQ
```

(A new session gets its own session URL from its system reminder; use
that one.)

## Git workflow, exactly

Feature branch: `claude/vibrant-cray-3ff4kq`. It is kept equal to `main`
after every deploy, so "on the branch" always means "main plus the new
work".

Feature: commit on the branch, `git push -u origin claude/vibrant-cray-3ff4kq`,
report, wait for "merge and deploy". Then:

```
git fetch origin main && git checkout main && git merge --ff-only origin/main
git merge --no-ff claude/vibrant-cray-3ff4kq -m "Merge branch 'claude/vibrant-cray-3ff4kq': <what>"
git push origin main
git push origin main:claude/vibrant-cray-3ff4kq
git branch -f claude/vibrant-cray-3ff4kq origin/claude/vibrant-cray-3ff4kq
git checkout claude/vibrant-cray-3ff4kq
```

Bug fix: commit on `main` directly (checkout main, ff to origin, commit,
push), then the same three sync lines. Commit as the owner:
`git -c user.email=galileouuu@gmail.com -c user.name="LeouDev" commit`.

Vercel deploys `main` automatically. Verify every push to main with
`python3 scripts/deploy-status.py <FULL sha>` in a 45-second loop (run it
in the background and read the output file) until it prints
`Production=success | ci: CI:completed/success`. A short sha prints
`none-yet` forever. Report the result to the owner; they read the last
message only.

## More than one session works on main

Another session (its branch was `claude/amazing-curie-b5ubwp` on 16–17
Sep) merges its own work into `main` while you work. So: `git fetch
origin main` immediately before every push to main. If the push is
rejected as non-fast-forward, your commit is still safe on local main:
`git rebase origin/main` (your own unpushed commit only — never rewrite
anything already pushed), re-run typecheck, lint, tests and build on the
combined tree, then push. The branch-sync line `git push origin
main:claude/vibrant-cray-3ff4kq` only works while the branch is an
ancestor of main; if it is rejected, check the branch out and
`git merge --ff-only main`, then push it normally.

## Verification before every commit

```
npx next typegen && npx tsc --noEmit     # typegen first or LayoutProps fails
npm run lint                             # 5 known warnings, 0 errors
npx vitest run                           # 91 files / 962 tests on 15 Sep 2026
npm run build                            # required: a "use server" file may
                                         # export only async functions, and
                                         # only the build catches that
```

The five lint warnings are pre-existing unused variables (two `id`, one
`paceColor` in `src/lib/case-tracker/report.ts`, and two more); leave
them. The build uses Turbopack's cache and can finish in a second on a
re-run; that is normal.

Smoke-rendering a component without the app: a temp `scripts/_check-*.tsx`
run with `npx tsx`, `renderToStaticMarkup`, then delete the script. Client
components that use `next/navigation` need stubs:
`AppRouterContext` from `next/dist/shared/lib/app-router-context.shared-runtime`
and `PathnameContext` / `SearchParamsContext` from
`next/dist/shared/lib/hooks-client-context.shared-runtime`, plus
`NavigationProgressProvider` for anything using `useNavigation`.

## Migrations, the routine that works

1. Add to `src/lib/db/schema.ts`.
2. `DATABASE_URL="postgres://x:x@localhost:5432/x" npx drizzle-kit generate --name <name>`.
   It numbers **one behind** and overwrites the previous snapshot: rename
   `drizzle/00NN_<name>.sql` and `drizzle/meta/00NN_snapshot.json` to the
   next number, set the new journal entry's `idx` (0053 has idx 52) and
   `tag`, then `git checkout -- drizzle/meta/<previous>_snapshot.json`.
   Check the new snapshot's `prevId` equals the previous snapshot's `id`.
3. Write `drizzle/APPLY_00NN_<NAME>.sql`: `begin;` guarded DDL (`if not
   exists` on types, tables, constraints, indexes), `enable row level
   security` plus policy `emr_app_full_access ... to emr_app` on every new
   table, a guarded insert into `drizzle.__drizzle_migrations (hash,
   created_at)` with the **sha256 of the migration file** and the
   journal's `when`, `commit;`, then a verify `select` with counts. Copy
   `APPLY_0051_SCORECARD_REVIEWS.sql` (tables) or `APPLY_0052_...` (columns).
4. Rehearse it twice on a scratch Postgres (idempotence), then
   `drizzle-kit generate` against that database must say "No schema
   changes". This container had `pg_ctlcluster 16 main start` and
   `postgres://gate:gate@localhost:5432/qa_check50` with the referenced
   tables, role `emr_app` and the tracker; a fresh container will not.
   Build one from the schema before trusting an apply script.
5. Send the owner the APPLY file. They paste it in the Supabase SQL editor
   as `postgres` and send a screenshot of the verify row. **The SQL runs
   before the code that reads the new tables is deployed.**

Latest migration: `0058_survey_responses` (17 Sep; the post-login survey's
answers, one row per account — a new table, so it carries RLS, the
`emr_app_full_access` policy and the grant; one paste of
`APPLY_0058_SURVEY_RESPONSES.sql`). Before it `0057_tech_decision_header`
(the AV, MPA and Fax QA forms ask for Tech Decision in place of Call
Reason — data only, no DDL, one paste of
`APPLY_0057_TECH_DECISION_HEADER.sql`), and
`0056_panda_fax_form` (the Fax QA form becomes PANDA Fax, scored per
attribute out of 100), and `0055_sunday_weeks` (every
stored week key from 30 May 2026 moves one day onto its Sunday — data
only, no DDL; the owner runs it by the runbook
`docs/sunday-week-recut.md`), and `0054_two_nesting_weeks` (the ramp has
two nesting weeks then eight ramp weeks, stages 0–9).

**The post-login survey gate** (`src/lib/survey/gate.ts`) blocks every page
under `(shell)` until an account has answered. `SURVEY_LIVE_FROM` controls
it: an ISO timestamp *with offset*, or the literal `off` to disable it
outright. Anything unparseable also reads as off, and `surveyDueFor` fails
open on a database error — this gate can lock the whole workforce out, so
every path that cannot answer lets the request through. If it misbehaves,
set `SURVEY_LIVE_FROM=off` and redeploy; that is the fastest switch there
is.

A form definition lives in `public.qa_forms`, which is what the app reads.
`src/lib/quality/forms.ts` only seeds a fresh database, so editing it
changes nothing in production until a migration carries the definition
over — 0047 and 0056 are the pattern.

`RECONCILE_TRACKER.sql` exists for a tracker that drifted once.

## Roles, access, accounts

`admin`, `manager`, `supervisor` (shown as "Team Leader"), `agent`,
`trainer` and `sme` (the support roles: read like an admin, work like a
team leader, no roster, leave or team-leader tooling). Every sign-up is
created **pending**; an admin activates it on the Users page and links it
to an employee ID (agents) or a manager name (managers). Since 14 Sep an
approval also marks the email confirmed in Supabase Auth, because company
mailboxes swallow the confirmation email. Sign-ups are limited to
`SIGNUP_EMAIL_DOMAINS`; an admin may change an account's email on the
Users page under the same domain rule. Leader roles need an authenticator
app from 2026-09-19 (`MFA_GRACE_UNTIL`). Supabase Auth email goes through
Custom SMTP (a Brevo relay, the same one the EOD report uses).

Environment variables (`.env.example`): `DATABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `EOD_SMTP_*`, `SIGNUP_EMAIL_DOMAINS`,
`MAIL_ALLOWED_DOMAINS`, `MFA_GRACE_UNTIL`. None of them is available in
the coding container; there is no database to run the app against here.

## Where things live

- `src/app/(shell)/` — every authenticated page; `layout.tsx` is the
  shell (sidebar + page column + MFA grace banner + progress bar).
- `src/components/app-sidebar.tsx` (server: data + per-role nav
  composition) → `sidebar-shell.tsx` (client: rail, drawer, toggles,
  scene) → `sidebar-nav.tsx` (links) + `nav-icons.tsx` (one glyph per
  href). Folded state is the `sidebar` cookie.
- `src/components/ui.tsx` — `Card`, `CardHeader`, `PageBand`,
  `StatusBadge`, `EmptyState`, `formatMetric`.
- `src/lib/db/schema.ts` — the whole schema. `src/lib/db/client.ts` — the
  pooled client behind `withQueryGate` (8 slots; never widen fan-outs).
- `src/lib/import-pipeline/` — workbook parsing and commit;
  `src/lib/action-item-engine/` — the pure engine and its persistence;
  `src/lib/scorecard/` — engine, bands, review windows, signatures, load;
  `src/lib/my-space/board.ts` — the daily board's pure parts;
  `src/lib/queries/` — page reads.
- `scripts/` — operator scripts run with `tsx --env-file=.env.local`
  (`import`, `reevaluate`, `backfill:*`, `dedupe:episodes`,
  `sync-auth-roles`, …) and `scripts/sql/app-role.sql` (the `emr_app`
  policies). `scripts/deploy-status.py` — the deploy poller.
- `docs/email-templates/` — the Supabase auth email bodies.

## What was built most recently (14–15 Sep 2026), newest first

- **Reporting weeks Sunday to Saturday from 31 May 2026** (17 Sep):
  the one rule is `weekContaining` in `src/lib/queries/period.ts` and
  its SQL twin `reportingWeekStart` in `src/lib/queries/week-sql.ts`
  (Saturday–Friday before the cut-over; the week of Sat 23 May runs
  eight days to Sat 30 May; Sunday–Saturday after). The import places
  each row by its own date from 23 May on
  (`src/lib/import-pipeline/week-placement.ts`; a dateless row in that
  range goes by its label and is counted in a warning), the ramp engine
  walks reporting weeks, the monthly PAR and scorecard week split use
  the SQL rule. Migration 0055 shifts every stored week key; the owner's
  order of operations (check, apply, deploy, re-import every workbook
  with rows from 30 May, Re-apply all ramps, check again) is
  `docs/sunday-week-recut.md`, with `scripts/sql/sunday-recut-check.sql`.
  The data itself is Saturday–Friday by the labels
  (`scripts/sql/week-boundary-check.sql`); the owner chose the
  operation's week regardless.
- **Quality "Audit completion" tab** (22 Sep): `/quality/completion`,
  a group of columns per team leader, one per audit week of the month,
  of the required audits filed against a 100% line, with a table under
  it (`src/lib/quality/completion.ts`, `getQaRosters`,
  `quality/completion/completion-chart.tsx`). Hidden from supervisors.
- **Progression search and action-item CSV** (22 Sep): a search box
  over supervisors and agents on the progression tab
  (`src/lib/ramp/progression-search.ts`), and "Export CSV" on the Action
  items page (`action-items/export/route.ts`, same filters and scope as
  the page).
- **Ramp page tabs** (22 Sep): "Progression by stage" (default; the
  other session's per-team progression with agent drill-down, stage
  notes and CSV/Excel export) and "Board" (who is ramping today, the
  date editor, Re-apply all, the start form). `?view=` in the URL,
  `src/app/(shell)/ramp/view-tabs.tsx`.
- **Ramp shape** (17 Sep): two nesting weeks, then Week 1 through Week 8,
  ten stages (`src/lib/ramp/engine.ts`). The start week is the first day
  of the first nesting week's reporting week (a Sunday now). Each board
  row's start date is editable in place (Save replays that person;
  Re-apply replays on the current date) and "Re-apply all ramps" replays
  every assignment after a schedule change.
- **Monthly PAR for a ramping agent** (17 Sep): the month's target is
  the plain average of each worked week's target (ramp stage or steady),
  `src/lib/ramp/effective-target.ts`, used by the period metrics and the
  scorecard. `scripts/sql/ramp-month-targets.sql` shows the resulting
  targets for a month; the owner runs it in the Supabase SQL editor.
- **Users page**: search (name / email / employee ID), editable email
  (Supabase Auth first, confirmed; company domain; not another
  account's), table widened so Save is in view.
- **Sidebar**: replaces the top nav. Collapsible rail (232px / 64px),
  toggle at top and foot, icons when folded, the astronaut scene in the
  spare height, wordmark "EMR / Command Center", drawer below `md`. The
  profile dialog is portalled to `document.body` — anything fixed inside
  the rail must be, because the rail carries a transform.
- **Attention required** (dashboard) honours `generates_action_items`
  like every other list: PAR/DPU/DPO never open items (0013), MBO
  stopped in 0041.
- **My Space** (`/my-space`, every role but agent): four boxes, Save day
  → dated snapshot on Manila time, History panel, planet progress rail.
  Tables `my_space_items`, `my_space_days` (0053). Private per account.
- **Approval confirms the email** in Supabase Auth (`email_confirm`).
- **Monthly scorecard** (`/scorecard`): weights Productivity 0.20 (PAR
  rating per skill, hour-weighted), Quality 0.20 (ancillary/phone by
  hour share), Errors 0.20 (critical / NPS), Standard Error 0.10, IRE
  0.10, PKT 0.10, Attendance 0.05, LH Utilization 0.05; six-month error
  windows; defaults IRE 0 / PKT 100 / LH 100 until the Monthly sheet
  exists (expected from October); review opens month end + 10 days;
  team leader signs (drawn signature), agent acknowledges; print A4
  landscape; Stack Rank ranks on this score, monthly only. Tables from
  0050–0052.

## Open items and things the owner knows about

- **The nightly integrity workflow** (`.github/workflows/integrity.yml`,
  `npm run check:integrity` locally) mails the owner on failure and
  writes the failing checks on the run's summary page; it had been red
  unnoticed for three nights, so check its latest run when you start. A
  red run is a same-day job: each check's "why" names its repair. The 33
  development items the separation sweep closed for active agents (17
  Sep) were reopened by the owner and replayed; the sweep now refuses a
  separation the employee row does not confirm, two checks watch for the
  pattern, and `npm run fix:false-separations` is the repair (notes
  bullets "Audit after the false separations" and "The nightly integrity
  run was red").
- **Masterlist month protection** (17 Sep): the weekly splice used to
  close a listed person's merged interval at 31 Aug (fixed, see the notes
  bullet "A weekly file closed a listed team"); the owner re-uploaded the
  September masterlist the same day and Herbias's cohort is open again
  from 29 Aug. If a team ever vanishes from a month, check read-only:
  `select a.supervisor_name, count(*) from employee_assignments a where
  a.effective_from <= '2026-09-30' and (a.effective_to is null or
  a.effective_to >= '2026-09-01') group by 1 order by 2 desc;` — every
  team should be present with its roster count.
- **The Sunday re-cut is not applied until the owner runs it**: section
  A of `scripts/sql/sunday-recut-check.sql`, then
  `APPLY_0055_SUNDAY_WEEKS.sql`, deploy, re-import every workbook with
  rows dated 30 May 2026 or later (oldest first), "Re-apply all ramps",
  section B. Until the re-imports, Sunday-keyed weeks still hold
  Saturday-to-Friday sums. `APPLY_0054_TWO_NESTING_WEEKS.sql` must go
  first if it has not been run.
- The **Monthly** import sheet (IRE, PKT, LH Utilization) is expected
  from October; until then those scorecard rows use defaults.
- The owner re-imports **the current month from its first day** with
  each upload; earlier months were re-imported in September so the
  Feedback tab's Standard column is populated back to March.
- **Stack Rank** scores the whole floor on every visit; cache it if it
  gets slow.
- The **user manual** (the owner keeps it outside the repo; a prompt for
  it sits in the session scratchpad only) still needs: the Users page
  screenshot placeholder, the support queue, My Space, the sidebar, the
  scorecard.
- `src/components/header-scene.tsx` is gone; its keyframes (`hdr-*`)
  stay in `globals.css` because the sidebar scene and the My Space rail
  use them.

## Gotchas that cost time this month

- `grep -E "->|x"` — the pattern starts with `-` and is read as an
  option; put `\-\>` or use `--`.
- `git rev-parse --short a b` fails; one revision at a time.
- Never run `prettier --write` on an existing file: the repo is not
  formatted that way and the diff explodes. Match the surrounding style.
- The React Compiler lint refuses `setState` inside an effect; derive
  state or key it on the value instead (see the sidebar drawer).
- `.border-b` is 2px by design (globals.css redefines it); a hairline is
  `border-b-[1px] border-line`.
- A background Bash loop with `sleep` works; a foreground `sleep` is
  blocked. Poll deploys in the background and read the output file.
- `npm ci` fails behind the proxy on the `xlsx` tarball; see the
  "Local development gotchas" section of the notes for the workaround.
- Dates: everything user-facing is on **Asia/Manila** (`todayInManila`
  in `src/lib/scorecard/review.ts`); never `toISOString().slice(0,10)`.
- Supabase's built-in mailer is rate-limited to a few emails an hour;
  Custom SMTP is on. The dashboard cannot show a saved SMTP password.

## How the owner works with you

Short messages, often a screenshot and one line. "Merge and deploy" is
the release approval and nothing else is. When they ask a question
("why does…"), answer it and offer the fix; do not push it until they say
so — except a confirmed bug, which they expect on main. They read only
your last message, so it has to stand alone: what changed, what was
verified, what they need to do (run SQL, sign in, check a page), and any
call you made on their behalf with how to reverse it.

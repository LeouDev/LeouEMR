import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageBand, StatCard } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { employees, ptoRequests, users } from "@/lib/db/schema";
import { resolveScopedIds } from "@/lib/queries/performance";
import {
  calendarViewFor,
  canSeeLeaveType,
  decidableLeaderIds,
  hasCluster,
  leaderAccountsOver,
  ptoViewIds,
} from "@/lib/pto/scope";
import { separatedBefore } from "@/lib/queries/eligibility";
import { countDays, daysIn } from "@/lib/pto/rules";
import { CancelButton, DecisionButtons, RequestForm } from "./pto-forms";
import { MANAGER_TABS, SUPERVISOR_TABS, ViewPicker } from "./view-picker";
import { PtoCalendar } from "./calendar";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-warn-bg text-warn",
  approved: "bg-pass-bg text-pass",
  denied: "bg-fail-bg text-fail",
  cancelled: "bg-line text-muted",
};

function Chip({ status }: { status: string }) {
  return (
    <span
      className={`inline-block px-2 py-1 text-[11px] font-bold tracking-[0.08em] uppercase ${
        STATUS_STYLE[status] ?? "bg-line text-muted"
      }`}
    >
      {status}
    </span>
  );
}

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/** A leader has no employee row, so their request is named by their account. */
function displayName(r: { employeeName: string | null; requesterName: string | null }) {
  return r.employeeName ?? r.requesterName ?? "Unknown";
}

/**
 * The PTO calendar, plus requesting and deciding.
 *
 * Everyone sees the same page; what it offers differs by role. An agent gets
 * a request form and their own history. A leader additionally gets the
 * pending queue for their team, because approving is the whole job here.
 */
export default async function PtoPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const params = await searchParams;
  const canDecide = user.role !== "agent";
  const showType = canSeeLeaveType(user);
  const view = calendarViewFor(user.role, params.view);

  // Calendar month, defaulting to the current one.
  const today = new Date().toISOString().slice(0, 10);
  // The month part must be 01-12: "2026-99" passes a bare \d{2} test and then
  // builds a date string Postgres rejects, turning a hand-edited URL into a 500.
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "")
    ? params.month!
    : today.slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);

  // Two scopes on purpose: `calendarIds` is who you may *see* out, which for
  // an agent is their team; `decidableIds` is who you may act on, which stays
  // exactly the performance scope. A wider view must never widen authority.
  //
  // Everything a later query needs is resolved in one batch here, and the
  // three request lists below are then fetched together as well — this page
  // used to walk six dependent round trips in a row (scope, then the
  // supervisors over it, then your own employee row, then the month, then
  // the pending queue, then your history), most of which never depended on
  // the one before. Nothing here fans out beyond a handful of small
  // queries at once, well inside the db client's pool.
  // The calendar shows the team as it stood in the month being viewed, by
  // the structure of record — the same rule the dashboard follows. Who the
  // viewer may decide for (decidableIds, leaderIds) stays on the current
  // structure: a wider or older view must never widen authority.
  const monthPeriod = { start: monthStart, end: monthEnd };
  const [viewIds, decidableIds, leaderIds, clusterAvailable, [ownEmployee], gone] = await Promise.all([
    ptoViewIds(user, view === "cluster" ? "cluster" : "team", monthPeriod),
    canDecide ? resolveScopedIds(user) : Promise.resolve([]),
    canDecide ? decidableLeaderIds(user) : Promise.resolve([]),
    hasCluster(user, monthPeriod),
    user.employeeEid
      ? db.select({ id: employees.id }).from(employees).where(eq(employees.eid, user.employeeEid)).limit(1)
      : Promise.resolve([undefined] as [undefined]),
    // Someone who left before this month is not on its calendar; they still
    // are on the calendar of the month they left and every month before.
    separatedBefore(monthStart),
  ]);
  const calendarIds = viewIds.filter((id) => !gone.has(id));

  const base = {
    id: ptoRequests.id,
    code: ptoRequests.code,
    employeeId: ptoRequests.employeeId,
    employeeName: employees.name,
    requesterName: users.name,
    startDate: ptoRequests.startDate,
    endDate: ptoRequests.endDate,
    type: ptoRequests.type,
    reason: ptoRequests.reason,
    status: ptoRequests.status,
    requestedBy: ptoRequests.requestedBy,
    decisionNote: ptoRequests.decisionNote,
  };

  // Second batch: the pending queue and your own history need nothing
  // beyond the first batch, so they run alongside the supervisor lookup
  // rather than behind it. Only the calendar read has to wait, because
  // which supervisors' own leave it shows depends on that lookup.
  const pendingQuery = canDecide && (decidableIds.length || leaderIds.length)
    ? db
        .select(base)
        .from(ptoRequests)
        .leftJoin(employees, eq(employees.id, ptoRequests.employeeId))
        .leftJoin(users, eq(users.id, ptoRequests.requestedBy))
        .where(
          and(
            or(
              decidableIds.length ? inArray(ptoRequests.employeeId, decidableIds) : undefined,
              // A supervisor's own request, which has no employee row at all.
              leaderIds.length
                ? and(isNull(ptoRequests.employeeId), inArray(ptoRequests.requestedBy, leaderIds))
                : undefined,
            ),
            eq(ptoRequests.status, "pending"),
          ),
        )
        .orderBy(asc(ptoRequests.startDate))
    : Promise.resolve([]);

  // Own history is keyed on the employee row for an agent and on the account
  // for a leader, who has none.
  const mineQuery = db
    .select(base)
    .from(ptoRequests)
    .leftJoin(employees, eq(employees.id, ptoRequests.employeeId))
    .leftJoin(users, eq(users.id, ptoRequests.requestedBy))
    .where(
      ownEmployee
        ? eq(ptoRequests.employeeId, ownEmployee.id)
        : and(isNull(ptoRequests.employeeId), eq(ptoRequests.requestedBy, user.id)),
    )
    .orderBy(desc(ptoRequests.startDate))
    .limit(50);

  // Approved leave still ahead for the people this leader decides for —
  // the list a cancellation is made from. Same authority as the pending
  // queue, so what is offered here is exactly what cancelPto allows.
  const upcomingQuery = canDecide && (decidableIds.length || leaderIds.length)
    ? db
        .select(base)
        .from(ptoRequests)
        .leftJoin(employees, eq(employees.id, ptoRequests.employeeId))
        .leftJoin(users, eq(users.id, ptoRequests.requestedBy))
        .where(
          and(
            or(
              decidableIds.length ? inArray(ptoRequests.employeeId, decidableIds) : undefined,
              leaderIds.length
                ? and(isNull(ptoRequests.employeeId), inArray(ptoRequests.requestedBy, leaderIds))
                : undefined,
            ),
            eq(ptoRequests.status, "approved"),
            gte(ptoRequests.endDate, today),
          ),
        )
        .orderBy(asc(ptoRequests.startDate))
        .limit(100)
    : Promise.resolve([]);

  const [leadersOver, pending, mine, upcoming] = await Promise.all([
    leaderAccountsOver(calendarIds, monthPeriod),
    pendingQuery,
    mineQuery,
    upcomingQuery,
  ]);
  // The leaders-only views: a manager's "Team leaders", and a supervisor's
  // "My cluster", which shows the leave of every team leader under the same
  // manager and none of the other teams' agents — a team leader arranges
  // cover with their peers, not with another leader's reports. The agent
  // ids still drive which leaders are found (leadersOver above); they are
  // simply not drawn. A manager's "Agents" view is the reverse. Every other
  // view carries both, since a team's calendar needs to show its own leader
  // out. Your own account always counts, so your own request shows on your
  // calendar whichever view.
  const leadersOnly = view === "leaders" || (user.role === "supervisor" && view === "cluster");
  const agentIds = leadersOnly ? [] : calendarIds;
  const leaderVisibleIds = view === "agents" ? [user.id] : [...new Set([user.id, ...leadersOver])];

  // Everything overlapping the visible month, for the calendar. Never
  // skipped for a month with no agents in it: a leader's own request, and
  // the other leaders' in a leaders-only view, still belong on that month.
  const inMonth = await db
    .select(base)
    .from(ptoRequests)
    .leftJoin(employees, eq(employees.id, ptoRequests.employeeId))
    .leftJoin(users, eq(users.id, ptoRequests.requestedBy))
    .where(
      and(
        or(
          agentIds.length ? inArray(ptoRequests.employeeId, agentIds) : undefined,
          // Leaders appear on the calendar of the people they lead. The
          // null employee id is what makes this a leader's *own* request
          // rather than anything else their account touched.
          and(isNull(ptoRequests.employeeId), inArray(ptoRequests.requestedBy, leaderVisibleIds)),
        ),
        lte(ptoRequests.startDate, monthEnd),
        gte(ptoRequests.endDate, monthStart),
        inArray(ptoRequests.status, ["pending", "approved"]),
      ),
    )
    .orderBy(asc(ptoRequests.startDate));


  // Approved days per person in the visible month, for the calendar cells.
  const byDay = new Map<string, Array<{ name: string; status: string; type: string | null }>>();
  for (const r of inMonth) {
    for (const day of daysIn(r)) {
      if (day < monthStart || day > monthEnd) continue;
      byDay.set(day, [
        ...(byDay.get(day) ?? []),
        { name: displayName(r), status: r.status, type: showType ? r.type : null },
      ]);
    }
  }

  const approvedDays = mine
    .filter((r) => r.status === "approved")
    .reduce((sum, r) => sum + countDays(r), 0);

  return (
    <>
      <PageBand title="Time off" subtitle="Request, approve and see who is out" />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Out this month" value={byDay.size === 0 ? 0 : inMonth.length} hint="In your scope" />
          {canDecide && (
            <StatCard
              label="Awaiting your decision"
              value={pending.length}
              tone={pending.length > 0 ? "warn" : "default"}
            />
          )}
          <StatCard label="My approved days" value={approvedDays} tone="pass" hint="All time" />
          <StatCard
            label="My open requests"
            value={mine.filter((r) => r.status === "pending").length}
          />
        </div>

        <Card>
          <CardHeader
            title="Calendar"
            subtitle={
              user.role === "agent"
                ? "Approved and pending leave across your team"
                : user.role === "supervisor"
                  ? view === "cluster"
                    ? "Approved and pending leave of the team leaders in your manager's cluster"
                    : "Approved and pending leave for your direct reports"
                  : user.role === "manager"
                    ? view === "agents"
                      ? "Approved and pending leave for the agents in your span"
                      : view === "leaders"
                        ? "Approved and pending leave for your team leaders"
                        : "Approved and pending leave across your span"
                    : "Approved and pending leave, organization-wide"
            }
            action={
              user.role === "manager" ? (
                <ViewPicker month={month} view={view} tabs={MANAGER_TABS} />
              ) : clusterAvailable ? (
                <ViewPicker month={month} view={view} tabs={SUPERVISOR_TABS} />
              ) : undefined
            }
          />
          <PtoCalendar month={month} view={view} byDay={byDay} />
        </Card>

        {canDecide && (
          <Card>
            <CardHeader
              title="Awaiting decision"
              subtitle={
                pending.length === 0
                  ? "Nothing to review"
                  : `${pending.length} request${pending.length === 1 ? "" : "s"} from your team`
              }
            />
            {pending.length === 0 ? (
              <EmptyState
                title="Nothing awaiting you"
                description="Requests from your team appear here as soon as they are submitted."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-ink bg-cream">
                      <th className={`${HEAD} px-6`}>Employee</th>
                      <th className={HEAD}>Dates</th>
                      <th className={HEAD}>Days</th>
                      <th className={HEAD}>Type</th>
                      <th className={HEAD}>Reason</th>
                      <th className={`${HEAD} px-6`}>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => (
                      <tr key={r.id} className="border-b-2 border-line last:border-0">
                        <td className="px-6 py-3 font-medium text-ink">
                          {displayName(r)}
                          {r.employeeId === null && (
                            <span className="ml-2 bg-line px-1.5 py-0.5 text-[10px] font-bold tracking-[0.06em] text-ink uppercase">
                              Supervisor
                            </span>
                          )}
                          <span className="block font-mono text-[10px] text-muted">{r.code}</span>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-ink">
                          {r.startDate}
                          {r.endDate !== r.startDate && ` → ${r.endDate}`}
                        </td>
                        <td className="px-3 py-3 font-mono tabular-nums text-ink">{countDays(r)}</td>
                        <td className="px-3 py-3 capitalize text-muted">{r.type}</td>
                        <td className="px-3 py-3 text-xs text-muted">{r.reason ?? "—"}</td>
                        <td className="px-6 py-3">
                          {r.requestedBy === user.id ? (
                            <span className="text-xs text-muted">Your own request</span>
                          ) : (
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <DecisionButtons requestId={r.id} />
                              <CancelButton requestId={r.id} label="Cancel" />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {canDecide && upcoming.length > 0 && (
          <Card>
            <CardHeader
              title="Approved leave ahead"
              subtitle={`${upcoming.length} approved request${upcoming.length === 1 ? "" : "s"} from today on, for the people you decide for`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className={`${HEAD} px-6`}>Employee</th>
                    <th className={HEAD}>Dates</th>
                    <th className={HEAD}>Days</th>
                    <th className={HEAD}>Type</th>
                    <th className={`${HEAD} px-6`} />
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((r) => (
                    <tr key={r.id} className="border-b-2 border-line last:border-0">
                      <td className="px-6 py-3 font-medium text-ink">
                        {displayName(r)}
                        {r.employeeId === null && (
                          <span className="ml-2 bg-line px-1.5 py-0.5 text-[10px] font-bold tracking-[0.06em] text-ink uppercase">
                            Supervisor
                          </span>
                        )}
                        <span className="block font-mono text-[10px] text-muted">{r.code}</span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-ink">
                        {r.startDate}
                        {r.endDate !== r.startDate && ` → ${r.endDate}`}
                      </td>
                      <td className="px-3 py-3 font-mono tabular-nums text-ink">{countDays(r)}</td>
                      <td className="px-3 py-3 capitalize text-muted">{r.type}</td>
                      <td className="px-6 py-3">
                        {r.requestedBy === user.id ? (
                          <span className="text-xs text-muted">Your own request</span>
                        ) : (
                          <CancelButton requestId={r.id} label="Cancel" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Request time off"
            subtitle={
              user.role === "supervisor"
                ? "Your manager decides your request"
                : user.role === "agent"
                  ? "Your supervisor is notified once you submit"
                  : "Recorded against your account"
            }
          />
          {user.employeeEid ? (
            <RequestForm />
          ) : (
            <EmptyState
              title="Account not linked"
              description="An administrator needs to link this account to an employee ID before you can request leave."
            />
          )}
        </Card>

        {mine.length > 0 && (
          <Card>
            <CardHeader title="My requests" subtitle={`${mine.length} in total`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className={`${HEAD} px-6`}>Dates</th>
                    <th className={HEAD}>Days</th>
                    <th className={HEAD}>Type</th>
                    <th className={HEAD}>Status</th>
                    <th className={HEAD}>Note</th>
                    <th className={`${HEAD} px-6`} />
                  </tr>
                </thead>
                <tbody>
                  {mine.map((r) => (
                    <tr key={r.id} className="border-b-2 border-line last:border-0">
                      <td className="px-6 py-3 font-mono text-xs text-ink">
                        {r.startDate}
                        {r.endDate !== r.startDate && ` → ${r.endDate}`}
                        <span className="block font-mono text-[10px] text-muted">{r.code}</span>
                      </td>
                      <td className="px-3 py-3 font-mono tabular-nums text-ink">{countDays(r)}</td>
                      <td className="px-3 py-3 capitalize text-muted">{r.type}</td>
                      <td className="px-3 py-3">
                        <Chip status={r.status} />
                      </td>
                      <td className="px-3 py-3 text-xs text-muted">{r.decisionNote ?? "—"}</td>
                      <td className="px-6 py-3">
                        {(r.status === "pending" || r.status === "approved") && (
                          <CancelButton requestId={r.id} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { NavLink } from "@/components/nav-link";
import { Card, CardHeader, EmptyState, PageBand, StatCard, StatusBadge } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { SUSTAINED_WEEKS, boardReaderFor, getDevelopmentBoard } from "@/lib/queries/development";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";
const ACTION_LINK =
  "border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand";

/** How many people's rows to show before the table scrolls, on a large board. */
const VISIBLE_ROWS = 20;

/** Progress toward the four sustained weeks that close an issue. */
function Progress({ weeks }: { weeks: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex gap-0.5">
        {Array.from({ length: SUSTAINED_WEEKS }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-3 ${i < weeks ? "bg-pass" : "bg-line"}`}
            aria-hidden
          />
        ))}
      </span>
      <span className="font-mono text-xs text-muted tabular-nums">
        {weeks}/{SUSTAINED_WEEKS}
      </span>
    </span>
  );
}

/** The hub's own URL with the given switches, so the two toggles compose. */
function hubHref(options: { all?: boolean; floor?: boolean }): string {
  const params = new URLSearchParams();
  if (options.all) params.set("all", "1");
  if (options.floor) params.set("scope", "floor");
  const query = params.toString();
  return query ? `/development?${query}` : "/development";
}

/**
 * The Development Hub: everyone with open development work, and what each
 * of them needs next.
 *
 * One row per person, one table. This used to be two tables — a board grouped
 * by person, then every item again in a flat list directly below it — which
 * doubled the scrolling for no new information: the same KPI, RCA and plan
 * status appeared twice. Each open item is now its own link right in the
 * person's row, so a supervisor with three items across three KPIs can jump
 * straight to the one they want instead of landing on the person's overview
 * and hunting for it.
 *
 * A leader's board is ordered by who is blocked on them rather than by
 * severity: an item with no root cause recorded cannot move at all, while
 * one three weeks into monitoring is already working. In practice almost
 * everything lands in "record root cause" — see the note below the table
 * when that dominates.
 *
 * A trainer or SME reads the whole floor, where that ordering only surfaces
 * hundreds of root causes that are the team leaders' to write. Their board
 * is a support queue instead: the items whose plan asked for training or
 * coaching, grouped by KPI and then by team leader so they can coach the
 * repeats together, with every open item one click away.
 */
export default async function DevelopmentPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string; scope?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const params = await searchParams;
  const reader = boardReaderFor(user);
  const isAgent = reader === "agent";
  const support = reader === "support";
  const floor = support && params.scope === "floor";
  const board = await getDevelopmentBoard(user, { everyItem: floor });
  const { totals } = board;

  // Only the first rows are rendered by default — the same number the
  // scroll box was already sized to show — with everyone else one click
  // away. For an admin or manager this board was the second-largest
  // response in the app (59 kB, measured), every item of every person in
  // development rendered into a box that shows twenty rows.
  const showAll = params.all === "1";
  const rows = showAll ? board.rows : board.rows.slice(0, VISIBLE_ROWS);
  const abridged = rows.length < board.rows.length;

  // When almost every row is stuck on the same step, the ordering that
  // usually surfaces what's most blocked stops differentiating anything —
  // it is worth saying so rather than leaving a wall of identical rows
  // unexplained. Only a leader's board is ordered that way.
  const stuckOnRca =
    reader === "leader" && board.rows.length > 3 && totals.missingRca / totals.openItems > 0.8;

  const scrolls = !isAgent && rows.length > VISIBLE_ROWS;
  const ordering = support ? "grouped by KPI, then by team leader" : "most blocked first";

  return (
    <>
      <PageBand
        title="Development Hub"
        subtitle={
          isAgent
            ? "Your individual development plan"
            : support
              ? floor
                ? "Every open development item on the floor"
                : "Where a team leader has asked for training or coaching"
              : "Individual development plans across your team"
        }
      />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {support ? (
            <>
              <StatCard
                label={floor ? "People in development" : "People needing support"}
                value={totals.peopleInDevelopment}
                hint={floor ? `${totals.openItems} open items` : `${totals.openItems} items asking for support`}
              />
              <StatCard
                label="Needs training"
                value={totals.needsTraining}
                tone={totals.needsTraining > 0 ? "warn" : "default"}
                hint="Marked on the action plan"
              />
              <StatCard
                label="Needs coaching"
                value={totals.needsCoaching}
                tone={totals.needsCoaching > 0 ? "warn" : "default"}
                hint="Marked on the action plan"
              />
              <StatCard
                label="In monitoring"
                value={totals.monitoring}
                hint="Plan acknowledged, counting weeks"
              />
              <StatCard
                label="Nearing close"
                value={totals.nearingClose}
                tone="pass"
                hint={`${SUSTAINED_WEEKS - 1}+ sustained weeks`}
              />
            </>
          ) : (
            <>
              <StatCard
                label={isAgent ? "My open items" : "People in development"}
                value={isAgent ? totals.openItems : totals.peopleInDevelopment}
                hint={isAgent ? undefined : `${totals.openItems} open items`}
              />
              {/* The alarm colours mark the reader's own move. A leader owes the
                  RCA and the plan; an agent owes the acknowledgement, and the
                  rest is with their supervisor. */}
              <StatCard
                label="Need root cause"
                value={totals.missingRca}
                tone={!isAgent && totals.missingRca > 0 ? "fail" : "default"}
                hint={isAgent ? "Your supervisor writes this" : "Cannot progress until written"}
              />
              <StatCard
                label="Need action plan"
                value={totals.missingPlan}
                tone={!isAgent && totals.missingPlan > 0 ? "warn" : "default"}
                hint={isAgent ? "Your supervisor writes this" : undefined}
              />
              <StatCard
                label="Awaiting acknowledgement"
                value={totals.awaitingAcknowledgement}
                tone={totals.awaitingAcknowledgement > 0 ? (isAgent ? "fail" : "warn") : "default"}
                hint={isAgent ? "Waiting on you" : "With the agent"}
              />
              <StatCard
                label="Nearing close"
                value={totals.nearingClose}
                tone="pass"
                hint={`${SUSTAINED_WEEKS - 1}+ sustained weeks`}
              />
            </>
          )}
        </div>

        <Card>
          <CardHeader
            title={
              isAgent
                ? "My development plan"
                : support
                  ? floor
                    ? "Every open item"
                    : "Support queue"
                  : "Development board"
            }
            subtitle={
              board.rows.length === 0
                ? support && !floor
                  ? "No team leader has asked for training or coaching"
                  : "Nothing in development"
                : abridged
                  ? support
                    ? `The first ${rows.length} of ${board.rows.length} people — ${ordering}`
                    : `The ${rows.length} most blocked of ${board.rows.length} people — an item with no root cause cannot move at all`
                  : scrolls
                    ? `Showing ${VISIBLE_ROWS} of ${board.rows.length} — ${ordering}, scroll for the rest`
                    : support
                      ? "Grouped by KPI, then by team leader — coach the repeats together"
                      : "Ordered by what is most blocked, not by severity — an item with no root cause cannot move at all"
            }
            action={
              support || abridged ? (
                <div className="flex flex-wrap gap-2">
                  {support && (
                    <NavLink href={hubHref({ floor: !floor })} prefetch={false} className={ACTION_LINK}>
                      {floor ? "Support requested only" : "Every open item"}
                    </NavLink>
                  )}
                  {abridged && (
                    <NavLink href={hubHref({ all: true, floor })} prefetch={false} className={ACTION_LINK}>
                      Show all {board.rows.length}
                    </NavLink>
                  )}
                </div>
              ) : undefined
            }
          />

          {board.rows.length === 0 ? (
            <EmptyState
              title={support && !floor ? "Nothing waiting on you" : "Nothing in development"}
              description={
                isAgent
                  ? "You have no open action items. Anything raised will appear here with the plan agreed with your supervisor."
                  : support && !floor
                    ? "A person appears here once a team leader's action plan marks training or coaching as required. Every open item on the floor is one click away above."
                    : support
                      ? "No one on the floor has an open action item."
                      : "No one on your team has an open action item. They appear here as soon as a KPI fails."
              }
            />
          ) : (
            <>
              {stuckOnRca && (
                <div className="border-b-2 border-line bg-cream px-6 py-3 text-xs text-muted">
                  Most of what&rsquo;s below is waiting on a root cause, so the ordering can&rsquo;t
                  tell you much beyond that — items with the same KPI often share one. Look for
                  repeats in the list before writing each one from scratch.
                </div>
              )}
              <div
                className="overflow-x-auto"
                style={
                  scrolls
                    ? { maxHeight: `${VISIBLE_ROWS * 57 + 42}px`, overflowY: "auto" }
                    : undefined
                }
              >
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead className={scrolls ? "sticky top-0 z-20" : undefined}>
                    <tr className="border-b-2 border-ink bg-cream">
                      {!isAgent && <th className={`${HEAD} px-6`}>Employee</th>}
                      {support && <th className={HEAD}>Team leader</th>}
                      <th className={`${HEAD} ${isAgent ? "px-6" : ""}`}>Open items</th>
                      <th className={HEAD}>Sustained progress</th>
                      <th className={`${HEAD} px-6`}>Next step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      // Red marks the reader's own move: for a leader the RCA and
                      // plan they owe, for an agent the plan waiting on their
                      // acknowledgement. A support role owns none of the steps,
                      // so only reopened work is coloured, as a heads-up.
                      const tone = support
                        ? row.urgency === 3
                          ? "text-warn"
                          : "text-muted"
                        : isAgent
                          ? row.urgency === 2
                            ? "text-fail"
                            : "text-muted"
                          : row.urgency <= 1
                            ? "text-fail"
                            : row.urgency <= 3
                              ? "text-warn"
                              : "text-muted";
                      return (
                        <tr
                          key={row.employeeId}
                          className="border-b-2 border-line bg-surface last:border-0 hover:bg-cream/60"
                        >
                          {!isAgent && (
                            <td className="px-6 py-3 align-top">
                              <Link
                                href={`/employees/${row.employeeId}`}
                                prefetch={false}
                                className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                              >
                                {row.employeeName}
                              </Link>
                            </td>
                          )}
                          {support && (
                            <td className="px-3 py-3 align-top text-muted">{row.supervisorName ?? "—"}</td>
                          )}
                          <td className={`py-3 align-top ${isAgent ? "px-6" : "px-3"}`}>
                            {/* A vertical stack here would center each line on its own axis —
                                readable as one line, ragged as a group, since the chips are
                                different widths. Wrapping them into one centered flex group
                                keeps the table's centering but reads as a single block. */}
                            <ul className="flex flex-wrap items-center justify-center gap-1.5">
                              {row.items.map((item) => (
                                <li key={item.actionItemId}>
                                  <Link
                                    href={`/action-items/${item.actionItemId}`}
                                    prefetch={false}
                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                                  >
                                    {item.kpiName}
                                    {!item.hasRca ? (
                                      <span className="bg-fail-bg px-1.5 py-0.5 text-[10px] font-bold text-fail no-underline">
                                        RCA
                                      </span>
                                    ) : !item.hasActionPlan ? (
                                      <span className="bg-warn-bg px-1.5 py-0.5 text-[10px] font-bold text-warn no-underline">
                                        Plan
                                      </span>
                                    ) : (
                                      <StatusBadge status={item.status} />
                                    )}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Progress weeks={row.bestProgress} />
                          </td>
                          <td className="px-6 py-3 align-top">
                            <span className={`text-xs font-semibold ${tone}`}>{row.nextStep}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </main>
    </>
  );
}

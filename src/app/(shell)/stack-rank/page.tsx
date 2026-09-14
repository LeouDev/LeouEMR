import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PeriodPicker } from "@/components/period-picker";
import { Card, CardHeader, EmptyState, PageBand, StatCard } from "@/components/ui";
import { getCurrentUser, type UserRole } from "@/lib/auth/session";
import { getOwnEmployee } from "@/lib/queries/my-stats";
import { periodContaining, periodsBetween } from "@/lib/queries/period";
import { getFactDateRange } from "@/lib/queries/period-metrics";
import { getStackRanks } from "@/lib/queries/stack-rank";
import { MINIMUM_SCORE } from "@/lib/scorecard/engine";
import { todayInManila } from "@/lib/scorecard/review";
import { NavLink } from "@/components/nav-link";
import { abridge, RankTable, SupervisorRankTable } from "./rank-table";

/** Rows of the organisation board rendered before "Show all" — the scroll box shows this many. */
const ORG_ROWS_SHOWN = 20;

/**
 * Stack ranks: your team, the whole organization, and every supervisor in it.
 *
 * Ranking is on the monthly scorecard's final score, the figure the business
 * rates performance with; the current month ranks on its running
 * month-to-date card. Monthly only, since that is the scorecard's grain.
 * Everyone sees the same ranking — a stack rank that hid your peers could
 * not tell you where you stand.
 */
export default async function StackRankPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; all?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  // Every role, spelled out on purpose rather than left as the absence of a
  // check: unlike the leader-only pages, a stack rank exists specifically so
  // an agent can see where they stand — narrowing this would defeat the
  // page. Reviewed and accepted alongside the org-wide ranking itself (see
  // the module doc comment above); this line exists so that acceptance is
  // legible in the code, not just in this comment.
  const ALLOWED_ROLES: UserRole[] = ["admin", "manager", "supervisor", "agent", "trainer", "sme"];
  if (!ALLOWED_ROLES.includes(user.role)) redirect("/dashboard");

  const [params, range, employee, cookieStore] = await Promise.all([
    searchParams,
    getFactDateRange(),
    getOwnEmployee(user.employeeEid),
    cookies(),
  ]);

  // Months only — the scorecard's grain — from the first fact to today, so
  // the current month is on the list as a running month-to-date ranking. The
  // shared period cookie (see period-picker.tsx) is honoured when it names a
  // month; an explicit URL param still wins.
  const granularity = "month" as const;
  const today = todayInManila();
  const periods = range ? periodsBetween(granularity, range.first, today > range.last ? today : range.last) : [];
  const period =
    periods.find((p) => p.start === params.period) ??
    (!params.period
      ? periods.find((p) => p.start === cookieStore.get("periodStart")?.value)
      : undefined) ??
    periods[0] ??
    (range ? periodContaining("month", range.last) : null);

  if (!period) {
    return (
      <>
        <PageBand title="Stack rank" subtitle="Where you stand" />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <EmptyState
              title="No performance data yet"
              description="Rankings appear once performance data has been imported."
            />
          </Card>
        </main>
      </>
    );
  }

  const ranks = await getStackRanks(user, employee, period);

  // How many of the ranking actually have a score this month. A single
  // person's data can extend the fact range — so the newest month may be one
  // almost nobody was measured in, and a table of 452 dashes sorted
  // alphabetically looks broken rather than empty.
  const scored = ranks.org.filter((r) => r.score !== null).length;
  const thinlyScored = ranks.org.length > 0 && scored <= Math.max(2, ranks.org.length * 0.05);
  const mine = employee ? ranks.org.find((r) => r.employeeId === employee.id) : undefined;
  const myTeamRank = employee ? ranks.team.find((r) => r.employeeId === employee.id) : undefined;

  // The whole-organisation table is ranked over everyone, but only what a
  // reader will actually look at is rendered by default: the top of the
  // board and, for an agent, the rows around their own place in it. The
  // table already scrolls inside a twenty-row box, yet every visit was
  // rendering and shipping all six-hundred-odd rows through it — the
  // single largest response in the app (80 kB and 1.5 s from a Philippine
  // desk, measured) for a box that shows twenty. "Show everyone" is one
  // click away and keeps the same period.
  const showAll = params.all === "1";
  const orgShown = showAll ? ranks.org : abridge(ranks.org, ORG_ROWS_SHOWN, mine?.rank);
  const showAllHref = `/stack-rank?${new URLSearchParams({ period: period.start, all: "1" })}`;

  return (
    <>
      <PageBand
        title="Stack rank"
        subtitle={`${period.label} · organization-wide · ranked on the monthly scorecard`}
        action={
          periods.length > 0 ? (
            <PeriodPicker
              basePath="/stack-rank"
              granularity={granularity}
              granularities={[granularity]}
              periods={periods}
              selected={period}
            />
          ) : undefined
        }
      />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Rank in team"
            value={myTeamRank ? `${myTeamRank.rank} of ${ranks.team.length}` : "—"}
            hint={ranks.teamLabel ?? undefined}
          />
          <StatCard
            label="Rank in organization"
            value={mine ? `${mine.rank} of ${ranks.org.length}` : "—"}
            hint="Across every site"
          />
          <StatCard
            label="Your score"
            value={mine?.score === null || mine === undefined ? "—" : mine.score.toFixed(2)}
            tone={
              mine?.score === null || mine === undefined
                ? "default"
                : mine.score >= MINIMUM_SCORE
                  ? "pass"
                  : "fail"
            }
            hint={`Monthly scorecard · ${MINIMUM_SCORE.toFixed(2)} is the minimum`}
          />
          <StatCard
            label="Your MBO"
            value={mine?.mbo === null || mine === undefined ? "—" : `${mine.mbo.toFixed(0)}%`}
          />
        </div>

        <Card>
          <CardHeader
            title="My team"
            subtitle={
              ranks.teamLabel
                ? `${ranks.team.length} people under ${ranks.teamLabel}`
                : "No supervisor recorded"
            }
          />
          <RankTable
            rows={ranks.team}
            selfId={employee?.id ?? null}
            emptyTitle="No team ranking"
            emptyDescription="Your supervisor is not recorded in the imported data, so there is no team to rank against."
          />
        </Card>

        {thinlyScored && (
          <Card>
            <div className="border-l-8 border-warn px-6 py-4">
              <p className="text-sm font-bold text-ink">
                Only {scored} of {ranks.org.length} people have a score for {period.label}
              </p>
              <p className="mt-1 text-sm text-muted">
                Ranking a month almost nobody was measured in is not meaningful — the rows below
                are mostly empty and fall back to alphabetical order. Pick an earlier month above.
              </p>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Whole organization"
            subtitle={
              showAll || orgShown.length === ranks.org.length
                ? mine && mine.score !== null
                  ? `${scored} of ${ranks.org.length} scored · you are ${mine.rank}, scroll to find yourself`
                  : `${scored} of ${ranks.org.length} people scored this period`
                : mine
                  ? `Top ${ORG_ROWS_SHOWN} of ${ranks.org.length}, and the rows around you at ${mine.rank} · ${scored} scored`
                  : `Top ${ORG_ROWS_SHOWN} of ${ranks.org.length} · ${scored} scored this period`
            }
            action={
              !showAll && orgShown.length < ranks.org.length ? (
                <NavLink
                  href={showAllHref}
                  prefetch={false}
                  className="border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:border-orange-brand hover:text-orange-brand"
                >
                  Show all {ranks.org.length}
                </NavLink>
              ) : undefined
            }
          />
          <RankTable
            rows={orgShown}
            selfId={employee?.id ?? null}
            showSupervisor
            visibleRows={20}
            emptyTitle="No organization ranking"
            emptyDescription="No active employees have a scorecard score for this month."
          />
        </Card>

        <Card>
          <CardHeader
            title="By supervisor"
            subtitle="Every supervisor in the organization, ranked by their team's mean scorecard score over the members who have one"
          />
          <SupervisorRankTable rows={ranks.supervisors} selfSupervisor={ranks.teamLabel} />
        </Card>
      </main>
    </>
  );
}

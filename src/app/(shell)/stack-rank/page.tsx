import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PeriodPicker } from "@/components/period-picker";
import { Card, CardHeader, EmptyState, PageBand, StatCard } from "@/components/ui";
import { getCurrentUser, type UserRole } from "@/lib/auth/session";
import { getOwnEmployee } from "@/lib/queries/my-stats";
import { parseGranularity, periodContaining, periodsBetween } from "@/lib/queries/period";
import { getFactDateRange } from "@/lib/queries/period-metrics";
import { getStackRanks } from "@/lib/queries/stack-rank";
import { NavLink } from "@/components/nav-link";
import { abridge, RankTable, SupervisorRankTable } from "./rank-table";

/** Rows of the organisation board rendered before "Show all" — the scroll box shows this many. */
const ORG_ROWS_SHOWN = 20;

/**
 * Stack ranks: your team, the whole organization, and every supervisor in it.
 *
 * Ranking is on the PAR production rating, the score the business already
 * rates performance with. Everyone sees the same ranking — a stack rank that
 * hid your peers could not tell you where you stand.
 */
export default async function StackRankPage({
  searchParams,
}: {
  searchParams: Promise<{ granularity?: string; period?: string; all?: string }>;
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
  const ALLOWED_ROLES: UserRole[] = ["admin", "manager", "supervisor", "agent"];
  if (!ALLOWED_ROLES.includes(user.role)) redirect("/dashboard");

  const [params, range, employee, cookieStore] = await Promise.all([
    searchParams,
    getFactDateRange(),
    getOwnEmployee(user.employeeEid),
    cookies(),
  ]);

  // Dashboard, MBO and Stack Rank share one PeriodPicker and remember the
  // same selection between them (see period-picker.tsx) — an explicit URL
  // param still wins, so a shared link or the back button shows what it
  // captured.
  const granularity = parseGranularity(
    params.granularity ?? cookieStore.get("periodGranularity")?.value ?? "month",
  );
  const periods = range ? periodsBetween(granularity, range.first, range.last) : [];
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

  // How many of the ranking actually have a rating this period. A single
  // person's data can extend the fact range — so the newest period may be one
  // almost nobody was measured in, and a table of 452 dashes sorted
  // alphabetically looks broken rather than empty.
  const scored = ranks.org.filter((r) => r.productionRate !== null).length;
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
  const showAllHref = `/stack-rank?${new URLSearchParams({ granularity, period: period.start, all: "1" })}`;

  return (
    <>
      <PageBand
        title="Stack rank"
        subtitle={`${period.label} · organization-wide`}
        action={
          periods.length > 0 ? (
            <PeriodPicker
              basePath="/stack-rank"
              granularity={granularity}
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
            label="Your rating"
            value={mine?.productionRate === null || mine === undefined ? "—" : mine.productionRate.toFixed(3)}
            tone={
              mine?.productionRate === null || mine === undefined
                ? "default"
                : mine.productionRate >= 3
                  ? "pass"
                  : "fail"
            }
            hint="PAR production rating"
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
                Only {scored} of {ranks.org.length} people have a rating for {period.label}
              </p>
              <p className="mt-1 text-sm text-muted">
                Ranking a period almost nobody was measured in is not meaningful — the rows below
                are mostly empty and fall back to alphabetical order. Pick an earlier period above.
              </p>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Whole organization"
            subtitle={
              showAll || orgShown.length === ranks.org.length
                ? mine && mine.productionRate !== null
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
            emptyDescription="No active employees have a scored rating for this period."
          />
        </Card>

        <Card>
          <CardHeader
            title="By supervisor"
            subtitle="Every supervisor in the organization, ranked by their team's mean rating over the members who have one"
          />
          <SupervisorRankTable rows={ranks.supervisors} selfSupervisor={ranks.teamLabel} />
        </Card>
      </main>
    </>
  );
}

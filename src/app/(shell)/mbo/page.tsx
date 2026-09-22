import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NavLink } from "@/components/nav-link";
import { PeriodPicker } from "@/components/period-picker";
import { Card, CardHeader, EmptyState, PageBand, StatCard } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { groupByLeader, matchesMboFilter, MBO_FILTERS, parseMboFilter, type MboFilter } from "@/lib/mbo/teams";
import { getMboRoster } from "@/lib/queries/mbo";
import { parseGranularity, periodContaining, periodsBetween } from "@/lib/queries/period";
import { getFactDateRange } from "@/lib/queries/period-metrics";
import { MboTeamTable, type MboTeamView } from "./team-table";

/**
 * What an empty tab means, in words that read as a sentence. Derived from
 * the tab label this used to say "No employee in your scope is everyone" and
 * "…is no score", which are not sentences anyone would write.
 */
const EMPTY_BY_FILTER: Record<MboFilter, (period: string) => string> = {
  all: (period) => `Nobody in your scope was measured in ${period}. Pick another period above, or check that this month's data has been imported.`,
  fail: (period) => `Nobody in your scope failed MBO in ${period}.`,
  pass: (period) => `Nobody in your scope passed MBO in ${period}.`,
  unscored: (period) => `Everyone in your scope has an MBO score for ${period}.`,
};

/**
 * Who is passing MBO and who is not, for a period, team by team.
 *
 * MBO is a composite of gates, so a bare pass/fail is not actionable on its
 * own — each row carries the gate values and names the ones that were
 * missed, and each team's band carries the same figures for the team.
 *
 * Every team's agents are in the page but the bands open on demand; the
 * "first fifty" cut this table used to make has gone with them, since a
 * closed band costs the reader nothing and the file is 43 kB at the most
 * for an admin's whole roster (measured before the change).
 */
export default async function MboPage({
  searchParams,
}: {
  searchParams: Promise<{ granularity?: string; period?: string; status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  // A hidden tab is not a permission check; agents read their own MBO on My Stats.
  if (user.role === "agent") redirect("/my-stats");

  const [params, range, cookieStore] = await Promise.all([
    searchParams,
    getFactDateRange(),
    cookies(),
  ]);

  // MBO is assessed monthly, so that is what this opens on absent any other
  // choice. Dashboard, MBO and Stack Rank share one PeriodPicker and remember
  // the same selection between them (see period-picker.tsx) — an explicit URL
  // param still wins, so a shared link or the back button shows what it captured.
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
        <PageBand title="MBO" subtitle="Pass and fail by team" />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <EmptyState
              title="No performance data yet"
              description="MBO results appear once performance data has been imported."
            />
          </Card>
        </main>
      </>
    );
  }

  const roster = await getMboRoster(user, period);
  const status = parseMboFilter(params.status);

  // The bands carry whole-team figures whichever tab is open; the tab only
  // decides which agents show under them, and a team with none drops out.
  const teams: MboTeamView[] = groupByLeader(roster.rows)
    .map((team) => ({ team, rows: team.rows.filter((row) => matchesMboFilter(row, status)) }))
    .filter(({ rows }) => rows.length > 0);
  const shown = teams.reduce((sum, { rows }) => sum + rows.length, 0);

  const query = (next: MboFilter) => {
    const p = new URLSearchParams({ granularity, period: period.start });
    if (next !== "all") p.set("status", next);
    return `/mbo?${p}`;
  };

  return (
    <>
      <PageBand
        title="MBO"
        subtitle={period.label}
        action={
          periods.length > 0 ? (
            <PeriodPicker
              basePath="/mbo"
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
            label="Passing MBO"
            value={roster.passing}
            tone="pass"
            hint={`of ${roster.passing + roster.failing} scored`}
            href={query("pass")}
          />
          <StatCard label="Failing MBO" value={roster.failing} tone="fail" href={query("fail")} />
          <StatCard
            label="No score"
            value={roster.unscored}
            hint="No data this period"
            href={query("unscored")}
          />
          <StatCard
            label="Pass rate"
            value={
              roster.passing + roster.failing === 0
                ? "—"
                : `${((roster.passing / (roster.passing + roster.failing)) * 100).toFixed(1)}%`
            }
          />
        </div>

        <Card>
          <CardHeader
            title={MBO_FILTERS.find((t) => t.key === status)!.label}
            subtitle={`${shown} employee${shown === 1 ? "" : "s"} across ${teams.length} team${teams.length === 1 ? "" : "s"} · ${period.label}`}
            action={
              <div className="flex flex-wrap items-center gap-3">
                {/* A plain link, not a button: a download is a navigation, and
                    it works with a middle click like every other file in the
                    app. Carries the period and tab so the file holds what the
                    bands show. */}
                {shown > 0 && (
                  <a
                    href={`/mbo/export?${new URLSearchParams({
                      granularity,
                      period: period.start,
                      ...(status === "all" ? {} : { status }),
                    })}`}
                    className="border-2 border-ink px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-orange-brand hover:text-orange-brand"
                  >
                    Export CSV
                  </a>
                )}
                <div className="flex border-2 border-ink">
                  {MBO_FILTERS.map((tab, i) => (
                    <NavLink
                      key={tab.key}
                      href={query(tab.key)}
                      prefetch={false}
                      className={`px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${
                        i > 0 ? "border-l-2 border-ink" : ""
                      } ${status === tab.key ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"}`}
                    >
                      {tab.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            }
          />

          {shown === 0 ? (
            <EmptyState
              title={status === "all" ? "No MBO data for this period" : "Nobody in this group"}
              description={EMPTY_BY_FILTER[status](period.label)}
            />
          ) : (
            <MboTeamTable teams={teams} />
          )}
        </Card>
      </main>
    </>
  );
}

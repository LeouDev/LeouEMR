import { redirect } from "next/navigation";
import { BarList, ChartFrame, TrendBarChart } from "@/components/charts";
import { NavLink } from "@/components/nav-link";
import { Card, CardHeader, PageBand, StatCard } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { getUtilization } from "@/lib/queries/utilization";
import {
  dailySeries,
  groupByManager,
  groupByTeam,
  manilaDay,
  parseDays,
  RANGE_OPTIONS,
  rangeEnding,
  totals,
  weeklySeries,
} from "@/lib/utilization/report";
import { SurveyTabs } from "../survey-tabs";
import { UtilizationTable } from "./utilization-table";

/**
 * Utilization: who is using the app day to day and how many end-of-day
 * reports go out, over the last week, fortnight, month or quarter — the
 * figures behind "is the team actually on this", by team and by manager.
 *
 * Administrator only, beside the survey: both are about how the tool is
 * received, and both name people.
 */
export default async function UtilizationPage({ searchParams }: { searchParams: Promise<{ days?: string; by?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if ((user.actualRole ?? user.role) !== "admin") redirect("/dashboard");

  const params = await searchParams;
  const days = parseDays(params.days);
  const by = params.by === "manager" ? "manager" : "team";
  const today = manilaDay();
  const range = rangeEnding(today, days);
  const accounts = await getUtilization(range);

  const daily = dailySeries(accounts, range.start, range.end);
  const series = days > 31 ? weeklySeries(accounts, range.start, range.end) : daily;
  const sums = totals(accounts, daily);
  const teams = groupByTeam(accounts);
  const managers = groupByManager(accounts);
  const bands = by === "team" ? teams : managers;
  const query = (next: { days?: number; by?: string }) =>
    `/survey-results/utilization?${new URLSearchParams({ days: String(next.days ?? days), by: next.by ?? by })}`;

  const rateRows = (list: typeof teams) =>
    list.map((b) => ({
      label: b.label,
      value: b.activeRate ?? 0,
      caption: `${b.active} of ${b.accounts} active · ${b.avgActiveDays} days each · ${b.eodSent} EOD`,
    }));

  return (
    <>
      <PageBand title="Survey Results" subtitle="Post-login survey responses and how the tool is used" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <SurveyTabs active="utilization" />

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {range.start} to {range.end}, Manila days · an account is active on a day it opened the app or sent anything
          </p>
          <div className="inline-flex border-2 border-ink">
            {RANGE_OPTIONS.map((option, i) => (
              <NavLink
                key={option}
                href={query({ days: option })}
                prefetch={false}
                className={`px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${i > 0 ? "border-l-2 border-ink" : ""} ${
                  option === days ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"
                }`}
              >
                {option} days
              </NavLink>
            ))}
          </div>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active accounts"
            value={sums.active}
            tone={sums.active > 0 ? "pass" : "default"}
            hint={`of ${sums.accounts} active accounts${sums.activeRate === null ? "" : ` · ${sums.activeRate}%`}`}
          />
          <StatCard label="Active today" value={sums.activeOnLastDay} hint={`On ${range.end}`} />
          <StatCard label="Daily active, average" value={sums.avgDailyActive} hint={`Per day over ${days} days`} />
          <StatCard label="EOD reports sent" value={sums.eodSent} hint={`Over ${days} days`} />
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartFrame title="Accounts active per day" subtitle={days > 31 ? "Distinct accounts per reporting week (Sunday to Saturday)" : "Distinct accounts that opened the app each day"}>
            <TrendBarChart buckets={series.map((p) => p.label)} values={series.map((p) => p.activeUsers)} selectedIndex={series.length - 1} emptyMessage="No days in range." />
          </ChartFrame>
          <ChartFrame title="EOD reports sent" subtitle={days > 31 ? "End-of-day reports emailed, per week" : "End-of-day reports emailed from the case tracker, per day"}>
            <TrendBarChart buckets={series.map((p) => p.label)} values={series.map((p) => p.eodSent)} selectedIndex={series.length - 1} emptyMessage="No days in range." />
          </ChartFrame>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartFrame title="Utilization per team" subtitle="Share of each team leader's accounts active in the range, the leader's own included">
            <BarList rows={rateRows(teams)} tone="better-when-higher" emptyMessage="No accounts yet." />
          </ChartFrame>
          <ChartFrame title="Utilization per manager" subtitle="Share of each manager's accounts active in the range — their leaders and agents">
            <BarList rows={rateRows(managers)} tone="better-when-higher" emptyMessage="No accounts yet." />
          </ChartFrame>
        </div>

        <Card>
          <CardHeader
            title={by === "team" ? "Accounts by team" : "Accounts by manager"}
            subtitle={`${bands.length} ${by === "team" ? "teams" : "managers"} · open a band for its accounts`}
            action={
              <div className="flex border-2 border-ink">
                {(["team", "manager"] as const).map((option, i) => (
                  <NavLink
                    key={option}
                    href={query({ by: option })}
                    prefetch={false}
                    className={`px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${i > 0 ? "border-l-2 border-ink" : ""} ${
                      option === by ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"
                    }`}
                  >
                    By {option}
                  </NavLink>
                ))}
              </div>
            }
          />
          <UtilizationTable key={`${by}-${days}`} bands={bands} days={days} now={new Date().toISOString()} />
        </Card>
      </main>
    </>
  );
}

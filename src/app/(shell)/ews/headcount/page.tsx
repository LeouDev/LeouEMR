import { StatCard } from "@/components/ui";
import { parseYear } from "@/lib/ews/headcount";
import { getEwsHeadcount, getEwsTeams } from "@/lib/queries/ews";
import { canRecord, requireEwsUser, resolveTeam, todayIso } from "../access";
import { EwsBand, EwsTabs } from "../ews-tabs";
import { EwsFilters } from "../team-select";
import { HeadcountTable } from "./headcount-table";

/**
 * Headcount: a year of monthly movement for one team, or every team in
 * scope added up. The team leader records each month's hires, transfers
 * and attrition; the opening carries forward and the closing is arithmetic
 * (src/lib/ews/headcount.ts). A summed view is read-only — a figure that
 * belongs to several teams is edited on each.
 */
export default async function HeadcountPage({ searchParams }: { searchParams: Promise<{ team?: string; year?: string }> }) {
  const user = await requireEwsUser();
  const params = await searchParams;
  const today = todayIso();
  const year = parseYear(params.year, today);
  const thisYear = Number(today.slice(0, 4));
  const teams = await getEwsTeams(user);
  const team = resolveTeam(user, teams, params.team);
  const view = await getEwsHeadcount(user, year, team);
  const { stats } = view;
  const editable = canRecord(user) && view.teams.length === 1 ? view.teams[0] : null;

  return (
    <>
      <EwsBand action={<EwsFilters basePath="/ews/headcount" teams={teams} team={team} year={year} years={[thisYear - 1, thisYear, thisYear + 1]} />} />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <EwsTabs active="headcount" team={team} />

        <div className="mb-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Projected EOY HC" value={stats.projectedEoy} hint="December closing" />
          <StatCard label="YTD new hires" value={stats.ytdNewHires} hint={stats.through ?? "Nothing recorded yet"} />
          <StatCard label="YTD voluntary attrition" value={stats.ytdVoluntary} hint="Resignations" />
          <StatCard label="YTD involuntary attrition" value={stats.ytdInvoluntary} hint="Terminations" />
          <StatCard
            label="Attrition % YTD"
            value={stats.attritionPct === null ? "—" : `${stats.attritionPct}%`}
            tone={stats.attritionPct !== null && stats.attritionPct > 0 ? "warn" : "default"}
            hint="Vs. January opening HC"
          />
        </div>

        <HeadcountTable chain={view.chain} year={year} team={editable} />
        <p className="mt-3.5 text-xs text-muted">
          Opening carries forward from the prior month&rsquo;s closing unless overridden. Months without an entry default to zero movement.
          {view.teams.length > 1 && " Every team in scope is added up here; pick a team to record its months."}
        </p>
      </main>
    </>
  );
}

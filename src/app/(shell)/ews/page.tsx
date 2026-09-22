import { StatCard } from "@/components/ui";
import { EWS_RISK_GUIDANCE } from "@/lib/ews/engine";
import { getEwsRoster, getEwsTeams } from "@/lib/queries/ews";
import { formatWeek } from "@/components/ui";
import { weekContaining } from "@/lib/queries/period";
import { canRecord, requireEwsUser, resolveTeam, todayIso } from "./access";
import { EwsBand, EwsTabs } from "./ews-tabs";
import { RosterTable } from "./roster-table";
import { EwsFilters } from "./team-select";

/**
 * My Team: everyone in the caller's span with their live retention risk,
 * worst first, and the form to record it. A supervisor sees their own
 * team; a manager or administrator picks a team or reads them all.
 *
 * The scoring is the established one (src/lib/ews/engine.ts); what is new
 * against the old board is that three of the ten indicators are read from
 * the week's figures rather than ticked (src/lib/ews/auto-indicators.ts),
 * and the record is edited here, in place, rather than on each person's
 * page one at a time.
 */
export default async function EwsPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const user = await requireEwsUser();
  const params = await searchParams;
  const teams = await getEwsTeams(user);
  const team = resolveTeam(user, teams, params.team);
  const roster = await getEwsRoster(user, team);
  const { totals } = roster;
  const today = todayIso();
  const week = roster.dataWeek?.start ?? weekContaining(today).start;
  const exportHref = `/ews/export${team ? `?team=${encodeURIComponent(team)}` : ""}`;

  return (
    <>
      <EwsBand action={<EwsFilters basePath="/ews" teams={teams} team={team} />} />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <EwsTabs active="team" team={team} />

        <div className="mb-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Critical" value={totals.black} tone={totals.black > 0 ? "fail" : "default"} hint={EWS_RISK_GUIDANCE.BLACK} />
          <StatCard label="At risk" value={totals.red} tone={totals.red > 0 ? "fail" : "default"} />
          <StatCard label="Watch" value={totals.yellow} tone={totals.yellow > 0 ? "warn" : "default"} />
          <StatCard label="Stable" value={totals.green} tone="pass" />
          <StatCard
            label="Team size"
            value={totals.size}
            hint={roster.dataWeek ? `Figures from the week of ${formatWeek(roster.dataWeek.start)}` : "No weekly data imported yet"}
          />
        </div>

        <RosterTable
          rows={roster.rows}
          indicators={roster.indicators}
          week={week}
          canEdit={canRecord(user)}
          showTeam={teams.length > 1}
          now={new Date().toISOString()}
          exportHref={exportHref}
        />
      </main>
    </>
  );
}

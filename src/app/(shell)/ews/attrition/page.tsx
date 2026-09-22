import { exitRowsOf, leaveRowsOf } from "@/lib/ews/export";
import { getEwsRoster, getEwsTeams } from "@/lib/queries/ews";
import { canRecord, requireEwsUser, resolveTeam, todayIso } from "../access";
import { EwsBand, EwsTabs } from "../ews-tabs";
import { EwsFilters } from "../team-select";
import { AttritionTables } from "./attrition-tables";

/**
 * Permanent Attrition: the confirmed exits, by the month they took effect,
 * and — separately — the leave register. Both come off the same roster
 * read as My Team, over everyone the scope reaches: an exit is a person
 * whose latest record carries the resignation/termination or absconding
 * tag (the system has separated them either way), a leave one whose
 * record carries LOA or maternity — away, and expected back.
 */
export default async function AttritionPage({ searchParams }: { searchParams: Promise<{ team?: string; month?: string }> }) {
  const user = await requireEwsUser();
  const params = await searchParams;
  const today = todayIso();
  const teams = await getEwsTeams(user);
  const team = resolveTeam(user, teams, params.team);
  const roster = await getEwsRoster(user, team, null);

  const exits = exitRowsOf(roster.rows);
  const leaves = leaveRowsOf(roster.rows);

  // The months that saw an exit, newest first, for the picker.
  const monthOf = (date: string | null) => (date ? date.slice(0, 7) : null);
  const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const seen = [...new Set(exits.map((e) => monthOf(e.date)).filter((m): m is string => m !== null))].sort().reverse();
  const month = params.month && seen.includes(params.month) ? params.month : "all";
  const months = [{ value: "all", label: "All months" }, ...seen.map((ym) => ({ value: ym, label: label(ym) }))];
  const shownExits = month === "all" ? exits : exits.filter((e) => monthOf(e.date) === month);
  const exportHref = `/ews/attrition/export${team ? `?team=${encodeURIComponent(team)}` : ""}`;

  return (
    <>
      <EwsBand action={<EwsFilters basePath="/ews/attrition" teams={teams} team={team} month={month} months={months} />} />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <EwsTabs active="attrition" team={team} />
        <AttritionTables
          exits={shownExits}
          leaves={leaves}
          canEdit={canRecord(user)}
          showTeam={teams.length > 1}
          today={today}
          exportHref={exportHref}
        />
      </main>
    </>
  );
}

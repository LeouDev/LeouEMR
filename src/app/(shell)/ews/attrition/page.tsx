import { getEwsRoster, getEwsTeams } from "@/lib/queries/ews";
import { canRecord, requireEwsUser, resolveTeam, todayIso } from "../access";
import { EwsBand, EwsTabs } from "../ews-tabs";
import { EwsFilters } from "../team-select";
import { AttritionTables, type ExitRow, type LeaveRow } from "./attrition-tables";

/**
 * Permanent Attrition: the confirmed exits, by the month they took effect,
 * and — separately — the leave and absence register. Both come off the
 * same roster read as My Team: an exit is a person whose latest record
 * carries the resignation/termination tag, a leave one whose record
 * carries absconding, LOA or maternity.
 */
export default async function AttritionPage({ searchParams }: { searchParams: Promise<{ team?: string; month?: string }> }) {
  const user = await requireEwsUser();
  const params = await searchParams;
  const today = todayIso();
  const teams = await getEwsTeams(user);
  const team = resolveTeam(user, teams, params.team);
  const roster = await getEwsRoster(user, team, null);

  const exits: ExitRow[] = roster.rows
    .filter((r) => r.attrition === "black")
    .map((r) => ({
      employeeId: r.employeeId,
      name: r.name,
      eid: r.eid,
      position: r.position,
      supervisorName: r.supervisorName,
      date: r.latest?.attritionDate ?? r.latest?.week ?? null,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.name.localeCompare(b.name));

  const leaves: LeaveRow[] = roster.rows
    .filter((r): r is typeof r & { attrition: "absconding" | "loa" | "maternity" } => r.flag === "leave")
    .map((r) => ({
      employeeId: r.employeeId,
      name: r.name,
      eid: r.eid,
      supervisorName: r.supervisorName,
      attrition: r.attrition,
      started: r.latest?.attritionDate ?? null,
      expectedReturn: r.latest?.expectedReturn ?? null,
      notes: r.latest?.notes ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

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

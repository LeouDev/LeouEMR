import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PeriodPicker } from "@/components/period-picker";
import { EmptyState, PageBand } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { MBO_GATES } from "@/lib/import-pipeline/par-scoring";
import {
  parseGranularity,
  periodContaining,
  periodsBetween,
  type Granularity,
} from "@/lib/queries/period";
import { getFactDateRange, getPeriodMetrics, withoutSkills } from "@/lib/queries/period-metrics";
import { getAgentHours, leadFirstName, listTeamLeads } from "@/lib/queries/team-roster";
import { rollUpSupervisorKpis } from "@/lib/queries/supervisor-kpis";
import { LeadPicker } from "./lead-picker";
// The column list and the row shape come from the neutral module, never from
// the client component: a value imported across that boundary arrives as a
// reference proxy, and iterating it throws at request time (see ./columns.ts).
import { ROSTER_COLUMNS, type RosterRow, type SortMode } from "./columns";
import { RosterTable } from "./roster-table";

/** The bar a pass rate has to clear before the strip stops calling it out — the business's MBO bar. */
const PASS_BAR = 90;

/**
 * Team Roster: every agent on one team lead's roster, with their whole KPI
 * line, worst first.
 *
 * The dashboard already shows a team, but collapsed to six rows and led by
 * the supervisor — it answers "which of my teams is struggling". This
 * answers the next question, "who on this team, and by how much", which is
 * the one a manager asks before a coaching conversation. Everyone on the
 * roster gets a row, including an agent with no results this period: a row
 * of dashes is information, and dropping them is how someone goes a month
 * unmeasured without anybody noticing.
 *
 * Admin and manager only. A team leader reads their own team on the
 * dashboard, where the same figures already are, and giving them a lead
 * picker would hand them other people's teams.
 */
export default async function TeamRosterPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; period?: string; granularity?: string; sort?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role !== "admin" && user.role !== "manager") redirect("/dashboard");

  const [params, range, cookieStore] = await Promise.all([
    searchParams,
    getFactDateRange(),
    cookies(),
  ]);

  // Week, month, quarter and year, through the control the rest of the app
  // uses — which also means this page opens on whatever period was last
  // picked on the dashboard, MBO or the stack rank rather than resetting.
  // A day is not offered: none of these measures means anything over one.
  const granularities: Granularity[] = ["week", "month", "quarter", "year"];
  const requested = parseGranularity(
    params.granularity ?? cookieStore.get("periodGranularity")?.value,
  );
  const granularity = granularities.includes(requested) ? requested : "month";
  const periods = range ? periodsBetween(granularity, range.first, range.last) : [];
  const period =
    periods.find((p) => p.start === params.period) ??
    (!params.period
      ? periods.find((p) => p.start === cookieStore.get("periodStart")?.value)
      : undefined) ??
    periods[0] ??
    (range ? periodContaining(granularity, range.last) : null);

  // Before a lead is settled the page has nobody to name, so the two empty
  // states below keep the generic heading.
  const band = <PageBand title="Team Roster" subtitle="Agent performance by team lead" />;

  if (!period) {
    return (
      <>
        {band}
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="border-2 border-ink bg-surface">
            <EmptyState
              title="Nothing imported yet"
              description="Once a weekly workbook has been imported there will be teams to browse here."
            />
          </div>
        </main>
      </>
    );
  }

  const leads = await listTeamLeads(user, period);
  if (leads.length === 0) {
    return (
      <>
        {band}
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="border-2 border-ink bg-surface">
            <EmptyState
              title="No team leads in this period"
              description={
                user.role === "manager"
                  ? "Nobody in your span held a team for this period. Try a wider period, or check that your account is linked to a manager name on the Users page."
                  : "No team lead held anyone for this period. Try a wider period."
              }
            />
          </div>
        </main>
      </>
    );
  }

  const lead = leads.find((l) => l.name === params.lead) ?? leads[0];
  const sort: SortMode = params.sort === "alpha" ? "alpha" : "worst";
  // "Team Brandon" — how the team is actually spoken about. The lead's full
  // name still leads the summary strip below, so the heading being a first
  // name loses nothing; an unassigned bucket has no lead to name and keeps
  // the generic heading.
  const firstName = leadFirstName(lead.name);
  const titled = (
    <PageBand
      title={firstName ? `Team ${firstName}` : "Team Roster"}
      subtitle="Agent performance by team lead"
    />
  );

  // One organisation-wide aggregation, then two small reads, and strictly
  // one after the other.
  //
  // This page first read the cells through `getTeamPeriodComparison`, whose
  // own `Promise.all` fans out five queries — two of them org-wide period
  // aggregations — and ran that concurrently with a second aggregation of
  // its own. That is the fan-out `manager-overview.tsx` documents as the
  // thing not to do ("Sequential, deliberately — not a Promise.all"), and
  // what `withQueryGate` names as having reached users as "Something went
  // wrong loading this page". It also asked for the previous period, which
  // this page never shows, and asked for the current one twice.
  //
  // Reading `getPeriodMetrics` directly gives the same numbers from the same
  // cache, once: the cells, the strip's roll-up and the hours all come off
  // it. What is given up is the comparison's case-rate gap-filling, which
  // only ever filled weeks imported before case rate became a KPI in
  // migration 0041 — `npm run backfill:case-rate` is the fix for those.
  const ids = lead.members.map((m) => m.employeeId);
  const metrics = withoutSkills(await getPeriodMetrics(ids, period));
  const hours = await getAgentHours(ids, period);

  const byEmployee = new Map<string, Map<string, { value: number; status: string }>>();
  for (const metric of metrics) {
    const forOne = byEmployee.get(metric.employeeId) ?? new Map();
    forOne.set(metric.kpiCode, { value: metric.actualValue, status: metric.status });
    byEmployee.set(metric.employeeId, forOne);
  }

  // Every member of the roster, measured or not. `getTeamPeriodComparison`
  // drops anyone with nothing measured this period, which is right for a
  // comparison table and wrong here: a row of dashes is how a leader sees
  // that somebody went unmeasured.
  const rows: RosterRow[] = lead.members.map((member) => {
    const measured = byEmployee.get(member.employeeId);
    const agentHours = hours.get(member.employeeId);
    const cells: RosterRow["cells"] = {};
    let below = 0;
    for (const column of ROSTER_COLUMNS) {
      const cell = measured?.get(column.code);
      const value = cell?.value ?? null;
      // PAR answers to the business's own 2.99 gate, the one MBO itself
      // applies, rather than to the KPI definition's status — which calls
      // exactly 2.99 a WARNING and would show a miss beside a strip
      // counting it as a pass, off the same number.
      const status =
        column.code === "PRODUCTION_RATE" && value !== null
          ? value >= MBO_GATES.productionRate
            ? "PASS"
            : "FAIL"
          : (cell?.status ?? null);
      cells[column.code] = { value, status };
      if (value !== null && status === "FAIL") below += 1;
    }
    return {
      employeeId: member.employeeId,
      name: member.name,
      eid: member.eid,
      below,
      phoneHours: agentHours ? agentHours.phone : null,
      nonPhoneHours: agentHours ? agentHours.nonPhone : null,
      hoursNote: agentHours
        ? agentHours.breakdown
            .map((s) => `${s.skill}: ${s.hours.toFixed(1)}h ${s.phone ? "(phone)" : "(non-phone)"}`)
            .join(" · ")
        : null,
      cells,
    };
  });

  // The same helper the manager dashboard's columns use, off the same
  // metrics, so a team's Prod pass and averages read identically on both.
  const kpis = rollUpSupervisorKpis(
    metrics,
    Object.fromEntries(ids.map((id) => [id, lead.name])),
  ).get(lead.name);
  const mboScored = rows.filter((r) => r.cells.MBO?.value !== null).length;
  const mboPassing = rows.filter((r) => r.cells.MBO?.status === "PASS").length;
  const belowTarget = rows.filter((r) => r.below > 0).length;

  return (
    <>
      {titled}
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3.5">
          <LeadPicker
            leads={leads.map((l) => l.name)}
            selected={lead.name}
            granularity={granularity}
            period={period.start}
            mode={
              user.role === "admin" ? "select" : leads.length > 1 ? "tabs" : "none"
            }
          />
          <PeriodPicker
            basePath="/team"
            granularity={granularity}
            granularities={granularities}
            periods={periods.length > 0 ? periods : [period]}
            selected={period}
            extraParams={{ lead: lead.name }}
          />
        </div>

        {/*
          Three rows, shared by every cell through `grid-rows-subgrid`: the
          label, the figure, the count beneath it. "Prod rating pass" wraps to
          two lines where "Team" does not, and without the shared rows that one
          label pushed its own number half a line below the rest. Subgrid rather
          than a reserved label height, so a label nobody has written yet cannot
          knock the row out of line again.
        */}
        <div className="mb-[18px] grid border-2 border-ink bg-surface lg:grid-cols-[2fr_repeat(6,1fr)] lg:grid-rows-[auto_auto_auto]">
          <div className="border-b-2 border-line px-5 py-4 lg:row-span-3 lg:grid lg:grid-rows-subgrid lg:border-r-2 lg:border-b-0">
            <div className="text-[11px] font-bold tracking-[0.1em] text-orange-brand uppercase">
              Team lead
            </div>
            <div className="mt-1.5 self-end text-[19px] font-extrabold text-ink">{lead.name}</div>
            <div className="mt-0.5 text-xs text-muted">
              {lead.site ?? "No site"} · reports to {lead.manager ?? "nobody on record"} ·{" "}
              {period.label}
            </div>
          </div>
          <StripCell label="Team" value={String(rows.length)} />
          <StripCell
            label="MBO pass"
            value={mboScored === 0 ? "—" : `${Math.floor((mboPassing / mboScored) * 100)}%`}
            note={mboScored === 0 ? "nobody scored" : `${mboPassing} of ${mboScored}`}
            fail={mboScored > 0 && (mboPassing / mboScored) * 100 < PASS_BAR}
          />
          <StripCell
            label="Prod rating pass"
            value={kpis?.prodPassRate == null ? "—" : `${Math.floor(kpis.prodPassRate)}%`}
            note={
              !kpis || kpis.prodScored === 0
                ? "nobody rated"
                : `${kpis.prodPassing} of ${kpis.prodScored}`
            }
            fail={kpis?.prodPassRate != null && kpis.prodPassRate < PASS_BAR}
          />
          <StripCell
            label="Avg quality"
            value={kpis?.quality == null ? "—" : `${Math.floor(kpis.quality)}%`}
            note={!kpis || kpis.qualityScored === 0 ? "nobody scored" : `avg of ${kpis.qualityScored}`}
          />
          <StripCell
            label="Avg NPS"
            value={kpis?.nps == null ? "—" : String(Math.floor(kpis.nps))}
            note={!kpis || kpis.npsScored === 0 ? "no surveys" : `avg of ${kpis.npsScored}`}
          />
          <StripCell
            label="Below target"
            value={belowTarget === 0 ? "—" : String(belowTarget)}
            note={`of ${rows.length}`}
            fail={belowTarget > 0}
            last
          />
        </div>

        {rows.length === 0 ? (
          <div className="border-2 border-ink bg-surface">
            <EmptyState
              title={`Nobody on ${lead.name}'s team for ${period.label}`}
              description="Everyone the roster named either joined after this period or had left before it. Try a different period."
            />
          </div>
        ) : (
          <RosterTable rows={rows} initialSort={sort} />
        )}
      </main>
    </>
  );
}

/**
 * One figure in the lead's summary strip.
 *
 * Whole numbers, rounded down, for the same reason the dashboard's
 * supervisor table does it: a figure must never disagree with its own
 * colour, and 89.6% rounded to nearest prints a red "90%" against a 90%
 * bar. The count beneath carries the exact reading.
 */
function StripCell({
  label,
  value,
  note,
  fail,
  last,
}: {
  label: string;
  value: string;
  note?: string;
  fail?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`border-b-2 border-line px-5 py-4 text-right lg:row-span-3 lg:grid lg:grid-rows-subgrid lg:border-b-0 ${
        last ? "" : "lg:border-r-2"
      }`}
    >
      <div className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">{label}</div>
      {/* Pinned to the bottom of its shared row, so a figure sits on the same
          line whether the label above it took one line or two. */}
      <div
        className={`mt-1.5 self-end font-mono text-[26px] leading-none font-extrabold tabular-nums ${
          fail ? "text-fail" : "text-ink"
        }`}
      >
        {value}
      </div>
      {/* Always rendered, so the cell fills all three rows and the one without
          a count does not pull its figure down into the gap. */}
      <div className="mt-1 text-[11px] text-muted">{note ?? "\u00A0"}</div>
    </div>
  );
}

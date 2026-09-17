import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PeriodPicker } from "@/components/period-picker";
import { EmptyState, PageBand } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { MBO_GATES } from "@/lib/import-pipeline/par-scoring";
import { getTeamPeriodComparison } from "@/lib/queries/my-stats";
import {
  parseGranularity,
  periodContaining,
  periodsBetween,
  type Granularity,
} from "@/lib/queries/period";
import { getFactDateRange, getPeriodMetrics } from "@/lib/queries/period-metrics";
import { getAgentHours, listTeamLeads } from "@/lib/queries/team-roster";
import { rollUpSupervisorKpis } from "@/lib/queries/supervisor-kpis";
import { LeadPicker } from "./lead-picker";
import { ROSTER_COLUMNS, RosterTable, type RosterRow, type SortMode } from "./roster-table";

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

  // Two reads of the same cached org-wide period metrics: the comparison
  // builds the per-agent cells, and the roll-up builds the strip's pass
  // rates and averages. Using the roll-up rather than recomputing here is
  // deliberate — it is the same helper the manager dashboard's columns use,
  // so a team's Prod pass and averages read identically on both pages.
  const [team, hours, metrics] = await Promise.all([
    getTeamPeriodComparison(lead.memberIds, period),
    getAgentHours(lead.memberIds, period),
    getPeriodMetrics(lead.memberIds, period),
  ]);

  const rows: RosterRow[] = team.rows.map((row) => {
    const agentHours = hours.get(row.employeeId);
    const cells: RosterRow["cells"] = {};
    let below = 0;
    for (const column of ROSTER_COLUMNS) {
      const cell = row.cells[column.code];
      const value = cell?.current ?? null;
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
      employeeId: row.employeeId,
      name: row.name,
      eid: row.eid,
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

  const rolled = rollUpSupervisorKpis(
    metrics,
    Object.fromEntries(lead.memberIds.map((id) => [id, lead.name])),
  );
  const kpis = rolled.get(lead.name);
  const mboScored = rows.filter((r) => r.cells.MBO?.value !== null).length;
  const mboPassing = rows.filter((r) => r.cells.MBO?.status === "PASS").length;
  const belowTarget = rows.filter((r) => r.below > 0).length;

  return (
    <>
      {band}
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

        <div className="mb-[18px] grid border-2 border-ink bg-surface lg:grid-cols-[2fr_repeat(6,1fr)]">
          <div className="border-b-2 border-line px-5 py-4 lg:border-r-2 lg:border-b-0">
            <div className="text-[11px] font-bold tracking-[0.1em] text-orange-brand uppercase">
              Team lead
            </div>
            <div className="mt-1.5 text-[19px] font-extrabold text-ink">{lead.name}</div>
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
      className={`border-b-2 border-line px-5 py-4 text-right lg:border-b-0 ${
        last ? "" : "lg:border-r-2"
      }`}
    >
      <div className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">{label}</div>
      <div
        className={`mt-1.5 font-mono text-[26px] leading-none font-extrabold tabular-nums ${
          fail ? "text-fail" : "text-ink"
        }`}
      >
        {value}
      </div>
      {note && <div className="mt-1 text-[11px] text-muted">{note}</div>}
    </div>
  );
}

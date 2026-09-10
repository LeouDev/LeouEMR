"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { KpiBreakdown, TopAgent } from "@/lib/queries/analytics";
import type { TeamPeriodComparison } from "@/lib/queries/my-stats";
import type { OrgTrend } from "@/lib/queries/team-trend";
import {
  ActionItemsSummary,
  DashboardShell,
  type ShellActionItems,
  type ShellContext,
  type ShellSeries,
} from "./dashboard-shell";
import { PeriodComparisonTable } from "./period-comparison-table";

export interface SupervisorRow {
  name: string;
  site: string | null;
  teamSize: number;
  failing: number;
  /** How many of the team actually had a result in the week Failing counts. */
  evaluated: number;
  openIssues: number;
  awaiting: number;
  /** Share of the team clearing every MBO gate, or null with nobody scored. */
  mboPassRate: number | null;
  mboPassing: number;
  mboScored: number;
}

export interface ManagerStats {
  failing: number;
  total: number;
  withData: number;
  asOfLabel: string | null;
  mboPassRate: number | null;
  mboPassing: number;
  mboScored: number;
  worstKpi: KpiBreakdown | null;
}

/** Above this share of the evaluated team failing, the row is the story rather than a footnote. */
const TEAM_ALARM = 0.3;
/** The business's own MBO bar, and the one the stat card upstream already uses. */
const MBO_BAR = 90;
/** Below this share meeting target, a KPI is worth calling out — the old 20% fail line, inverted. */
const ACHIEVED_BAR = 80;

export function ManagerDashboard({
  stats,
  supervisors,
  asOfLabel,
  trend,
  kpis,
  topAgents,
  comparison,
  supervisorByEmployee,
  actionItems,
  statuses,
  periodLabel,
  mboTree,
}: {
  stats: ManagerStats;
  supervisors: SupervisorRow[];
  /** The week Failing is measured over — the newest one inside the range. */
  asOfLabel: string | null;
  trend: OrgTrend;
  kpis: KpiBreakdown[];
  topAgents: TopAgent[];
  /** The KPI-by-employee matrix, narrowed to a supervisor's team when one is selected below. */
  comparison: TeamPeriodComparison | null;
  supervisorByEmployee: Record<string, string | null>;
  actionItems: ShellActionItems;
  statuses: Array<{ status: string; count: number; label: string }>;
  periodLabel: string;
  /** The existing attainment tree, kept behind a disclosure. */
  mboTree: React.ReactNode;
}) {
  // Which supervisor's team the trend is confined to. The rows stay visible
  // either way: this narrows the chart, it does not filter the page.
  const [scope, setScope] = useState<string | null>(null);
  const scoped = scope !== null && trend.bySupervisor[scope] ? trend.bySupervisor[scope] : null;
  const source = scoped ?? trend.whole;

  // The same click narrows the KPI-by-employee matrix, not only the chart:
  // a manager picking a supervisor is asking "show me that team," and the
  // trend without the table beside it answers only half of that.
  const scopedComparison: TeamPeriodComparison | null = useMemo(() => {
    if (!comparison) return null;
    if (scope === null) return comparison;
    return { ...comparison, rows: comparison.rows.filter((r) => supervisorByEmployee[r.employeeId] === scope) };
  }, [comparison, scope, supervisorByEmployee]);

  const series: ShellSeries[] = source.map((s) => ({
    key: s.key,
    label: s.label,
    note: s.note,
    target: s.target,
    format: s.unit,
    points: s.points.map((p) => ({ weekStart: p.weekStart, value: p.value, caption: p.caption })),
  }));

  const totalItems = statuses.reduce((n, s) => n + s.count, 0);
  const statusTone: Record<string, string> = {
    OPEN: "var(--color-fail)",
    AWAITING_AGENT_ACKNOWLEDGEMENT: "var(--color-orange-brand)",
    ACKNOWLEDGED: "var(--color-navy)",
    MONITORING: "var(--color-ink-muted)",
    SUSTAINED: "var(--color-pass)",
    RESOLVED: "var(--color-pass)",
    REOPENED: "var(--color-fail)",
  };

  const summary = ({ select }: ShellContext) => (
    <>
      <div>
        <h6 className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">Summary</h6>
        <div className="mt-1.5 font-sans text-[56px] leading-none font-extrabold">
          <span className={stats.failing === 0 ? "text-pass" : "text-ink"}>
            {Math.max(0, stats.withData - stats.failing)}
          </span>
          <span className="text-ink-faint">/{stats.withData}</span>
        </div>
        <p className="mt-1.5 text-[13px] text-ink">
          agent{stats.withData - stats.failing === 1 ? "" : "s"} meeting every KPI
          {stats.asOfLabel ? `, week of ${stats.asOfLabel}` : ""}
        </p>
        {/* The count needing attention keeps its own line: inverting a rate
            is a change of framing, losing the number to act on is not. */}
        <p className="mt-0.5 text-xs text-muted">
          {stats.failing > 0 ? (
            <span className="font-semibold text-fail">{stats.failing} below target</span>
          ) : (
            <span>none below target</span>
          )}{" "}
          · {stats.withData} of {stats.total} with data · any KPI, not just MBO
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3.5 text-[13px]">
        <div className="flex justify-between">
          <span className="text-muted">MBO pass rate</span>
          <span
            className={
              stats.mboPassRate !== null && stats.mboPassRate < MBO_BAR
                ? "font-semibold text-fail"
                : "text-ink"
            }
          >
            {stats.mboPassRate === null ? "—" : `${stats.mboPassRate.toFixed(1)}%`}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Clearing every gate</span>
          <span>
            {stats.mboScored === 0 ? "—" : `${stats.mboPassing} of ${stats.mboScored}`}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted">Weakest KPI</span>
          {stats.worstKpi ? (
            <button
              type="button"
              onClick={() => select(`KPI_${stats.worstKpi!.code}`)}
              className={`text-right ${
                100 - stats.worstKpi.failRate <= ACHIEVED_BAR
                  ? "font-semibold text-fail"
                  : "text-ink"
              } hover:underline`}
            >
              {stats.worstKpi.name} · {stats.worstKpi.total - stats.worstKpi.failing}/
              {stats.worstKpi.total} met
            </button>
          ) : (
            <span className="text-muted">—</span>
          )}
        </div>
      </div>

      <div>
        <ActionItemsSummary items={actionItems} />
        {totalItems > 0 && (
          <div className="mt-3 flex h-2 overflow-hidden bg-line">
            {statuses.map((s) => (
              <div
                key={s.status}
                style={{
                  width: `${(s.count / totalItems) * 100}%`,
                  backgroundColor: statusTone[s.status] ?? "var(--color-navy)",
                }}
                title={`${s.label}: ${s.count}`}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <DashboardShell
        summary={summary}
        series={series}
        trendTitle={scoped ? `${scope}'s team` : "Whole span"}
        emptyTrendMessage="No week-by-week history for your span yet."
        rows={() => (
          <>
              <div className="grid border-b-2 border-ink text-[11px] font-bold tracking-[0.08em] text-muted uppercase lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr]">
                <div className="py-3 lg:pl-6">Supervisor</div>
                <div className="hidden py-3 pr-5 text-right lg:block">Team</div>
                <div className="hidden py-3 pr-5 text-right lg:block">
                  Failing
                  <span className="block font-normal normal-case tracking-normal">
                    {asOfLabel ? `wk of ${asOfLabel}` : "no reporting week in this period yet"}
                  </span>
                </div>
                <div className="hidden py-3 pr-5 text-right lg:block">MBO pass</div>
                <div className="hidden py-3 pr-5 text-right lg:block">Open</div>
                <div className="hidden py-3 pr-5 text-right lg:block">Awaiting ack</div>
              </div>

              {supervisors.map((s) => {
                const isScope = scope === s.name;
                const alarming = s.evaluated > 0 && s.failing / s.evaluated >= TEAM_ALARM;
                const mboLow = s.mboPassRate !== null && s.mboPassRate < MBO_BAR;
                return (
                  <button
                    key={s.name}
                    type="button"
                    aria-pressed={isScope}
                    onClick={() => setScope(isScope ? null : s.name)}
                    className={`grid w-full cursor-pointer border-b-2 border-ink text-left transition hover:bg-cream lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] ${
                      isScope ? "bg-cream shadow-[inset_3px_0_0_var(--color-orange-brand)]" : ""
                    }`}
                  >
                    <span className="flex flex-col gap-0.5 py-4 lg:pl-6">
                      <strong className="text-sm text-ink">{s.name}</strong>
                      <span className="text-[11px] text-muted">{s.site ?? "—"}</span>
                    </span>
                    <Figure value={s.teamSize} label="team" />
                    <Figure
                      value={s.evaluated > 0 ? s.failing : "—"}
                      label={s.evaluated > 0 ? `of ${s.evaluated} evaluated` : "nobody evaluated"}
                      tone={alarming ? "fail" : undefined}
                    />
                    <Figure
                      value={s.mboPassRate === null ? "—" : `${s.mboPassRate.toFixed(0)}%`}
                      label={s.mboScored === 0 ? "nobody scored" : `${s.mboPassing} of ${s.mboScored}`}
                      tone={mboLow ? "fail" : undefined}
                    />
                    <Figure value={s.openIssues} label="open" />
                    <Figure
                      value={s.awaiting || "—"}
                      label="awaiting"
                      tone={s.awaiting >= 3 ? "fail" : undefined}
                    />
                  </button>
                );
              })}
          </>
        )}
      />

      {scopedComparison && (
        <div>
          {scope !== null && (
            <p className="mt-6 text-xs text-muted">
              Showing <strong className="text-ink">{scope}&rsquo;s</strong> team only — select their row
              above again to clear.
            </p>
          )}
          <PeriodComparisonTable data={scopedComparison} forSelf={false} />
        </div>
      )}

      <div className="mt-7 grid gap-9 border-t-2 border-ink pt-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <h6 className="text-[11px] font-bold tracking-[0.1em] text-orange-brand uppercase">
              Achievement by KPI
            </h6>
            <span className="text-xs text-muted">{periodLabel} · share of weekly results meeting target</span>
          </div>
          {kpis.length === 0 ? (
            <p className="py-6 text-sm text-muted">No KPI had data in this range.</p>
          ) : (
            kpis.map((k) => (
              <div
                key={k.code}
                className="grid grid-cols-[130px_1fr_84px] items-center gap-3 border-b border-line py-1.5 text-[13px]"
              >
                {/* The denominator travels with the rate: Cases Per Hour reads
                    100% fail off three weekly results, because nearly everyone
                    is scored on case rate instead. */}
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-ink" title={k.name}>
                    {k.name}
                  </span>
                  <span className="text-[10px] text-muted">
                    {k.total - k.failing} of {k.total}
                  </span>
                </span>
                <span className="h-2.5 bg-cream-dark">
                  <span
                    className="block h-full"
                    style={{
                      width: `${Math.min(100, 100 - k.failRate)}%`,
                      backgroundColor:
                        100 - k.failRate <= ACHIEVED_BAR
                          ? "var(--color-orange-brand)"
                          : "var(--color-ink)",
                    }}
                  />
                </span>
                <span
                  className={`text-right font-mono font-extrabold tabular-nums ${
                    100 - k.failRate <= ACHIEVED_BAR ? "text-fail" : "text-ink"
                  }`}
                >
                  {(100 - k.failRate).toFixed(1)}%
                </span>
              </div>
            ))
          )}
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <h6 className="text-[11px] font-bold tracking-[0.1em] text-orange-brand uppercase">
              Top agents in my span
            </h6>
            <span className="text-xs text-muted">Highest PAR · {periodLabel}</span>
          </div>
          {topAgents.length === 0 ? (
            <p className="py-6 text-sm text-muted">
              No one in your span has a production rating for this period.
            </p>
          ) : (
            topAgents.map((a, i) => (
              <div
                key={a.employeeId}
                className="grid grid-cols-[24px_1fr_auto] items-baseline gap-3 border-b border-line py-1.5 text-[13px]"
              >
                <span className="font-mono text-[11px] text-muted tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="truncate">
                  <Link
                    href={`/employees/${a.employeeId}`}
                    prefetch={false}
                    className="font-semibold text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                  >
                    {a.name}
                  </Link>
                  <span className="ml-1.5 text-xs text-muted">{a.supervisor ?? "Unassigned"}</span>
                </span>
                <span className="font-mono font-extrabold tabular-nums">
                  {a.productionRate.toFixed(2)}
                  {a.mbo !== null && (
                    <span className="ml-1 text-xs font-normal text-muted">
                      · MBO {a.mbo.toFixed(0)}%
                    </span>
                  )}
                </span>
              </div>
            ))
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted hover:text-orange-brand">
              MBO attainment by site → supervisor → agent
            </summary>
            <div className="mt-3">{mboTree}</div>
          </details>
        </div>
      </div>
    </>
  );
}

function Figure({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone?: "fail";
}) {
  return (
    <span className="flex flex-col gap-0.5 py-4 pr-5 text-right">
      <span
        className={`font-mono text-2xl leading-none font-extrabold tabular-nums ${
          tone === "fail" ? "text-fail" : "text-ink"
        }`}
      >
        {value}
      </span>
      <span className="text-[11px] font-normal text-muted">{label}</span>
    </span>
  );
}

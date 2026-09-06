import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { PeriodPicker } from "@/components/period-picker";
import { Card, CardHeader, EmptyState, PageBand, StatCard } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { getMboRoster } from "@/lib/queries/mbo";
import { parseGranularity, periodContaining, periodsBetween } from "@/lib/queries/period";
import { getFactDateRange } from "@/lib/queries/period-metrics";

type Filter = "all" | "pass" | "fail" | "unscored";

const TABS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "fail", label: "Failing" },
  { key: "pass", label: "Passing" },
  { key: "unscored", label: "No score" },
];

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

function pct(value: number | null, digits = 1) {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

/**
 * Who is passing MBO and who is not, for a period.
 *
 * MBO is a composite of gates, so a bare pass/fail is not actionable on its
 * own — each row carries the gate values and names the ones that were missed.
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

  const [params, range] = await Promise.all([searchParams, getFactDateRange()]);

  // MBO is assessed monthly, so that is what this opens on.
  const granularity = parseGranularity(params.granularity ?? "month");
  const periods = range ? periodsBetween(granularity, range.first, range.last) : [];
  const period =
    periods.find((p) => p.start === params.period) ??
    periods[0] ??
    (range ? periodContaining("month", range.last) : null);

  if (!period) {
    return (
      <div className="min-h-screen bg-cream">
        <AppHeader user={user} current="/mbo" />
        <PageBand title="MBO" subtitle="Pass and fail by employee" />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <EmptyState
              title="No performance data yet"
              description="MBO results appear once performance data has been imported."
            />
          </Card>
        </main>
      </div>
    );
  }

  const roster = await getMboRoster(user, period);
  const status = (TABS.find((t) => t.key === params.status)?.key ?? "all") as Filter;

  const shown = roster.rows.filter((r) =>
    status === "pass"
      ? r.passing === true
      : status === "fail"
        ? r.passing === false
        : status === "unscored"
          ? r.passing === null
          : true,
  );

  const query = (next: Filter) => {
    const p = new URLSearchParams({ granularity, period: period.start });
    if (next !== "all") p.set("status", next);
    return `/mbo?${p}`;
  };

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/mbo" />
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
            title={TABS.find((t) => t.key === status)!.label}
            subtitle={`${shown.length} employee${shown.length === 1 ? "" : "s"} · ${period.label}`}
            action={
              <div className="flex border-2 border-ink">
                {TABS.map((tab, i) => (
                  <Link
                    key={tab.key}
                    href={query(tab.key)}
                    className={`px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ${
                      i > 0 ? "border-l-2 border-ink" : ""
                    } ${status === tab.key ? "bg-ink text-white" : "bg-surface text-ink hover:bg-orange-brand-100"}`}
                  >
                    {tab.label}
                  </Link>
                ))}
              </div>
            }
          />

          {shown.length === 0 ? (
            <EmptyState
              title="Nobody in this group"
              description={`No employee in your scope is ${TABS.find((t) => t.key === status)!.label.toLowerCase()} for ${period.label}.`}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className={`${HEAD} px-6`}>Employee</th>
                    <th className={HEAD}>Supervisor</th>
                    <th className={HEAD}>MBO</th>
                    <th className={HEAD}>Production rate</th>
                    <th className={HEAD}>DPU</th>
                    <th className={HEAD}>DPO</th>
                    <th className={`${HEAD} px-6`}>Gates missed</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.employeeId} className="border-b-2 border-line last:border-0 hover:bg-cream">
                      <td className="px-6 py-2.5">
                        <Link
                          href={`/employees/${row.employeeId}`}
                          prefetch={false}
                          className="font-medium text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                        >
                          {row.name}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-muted">{row.eid}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted">{row.supervisorName ?? "—"}</td>
                      <td
                        className={`px-3 py-2.5 font-mono font-semibold tabular-nums ${
                          row.passing === null ? "text-muted" : row.passing ? "text-pass" : "text-fail"
                        }`}
                      >
                        {pct(row.mbo, 0)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted tabular-nums">
                        {row.productionRate === null ? "—" : row.productionRate.toFixed(3)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted tabular-nums">{pct(row.dpu)}</td>
                      <td className="px-3 py-2.5 font-mono text-muted tabular-nums">{pct(row.dpo)}</td>
                      <td className="px-6 py-2.5 text-xs">
                        {row.failedGates.length === 0 ? (
                          <span className="text-muted">{row.passing === null ? "no data" : "—"}</span>
                        ) : (
                          <span className="bg-fail-bg px-2 py-1 font-semibold text-fail">
                            {row.failedGates.join(", ")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

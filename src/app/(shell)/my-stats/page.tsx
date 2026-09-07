import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageBand, formatMetric, metricTone } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { skillReferences } from "@/lib/db/schema";
import { getFactDateRange } from "@/lib/queries/period-metrics";
import { getMonthComparison, getNpsBreakdown, getOwnEmployee } from "@/lib/queries/my-stats";
import { getTrackerSkills } from "@/lib/queries/case-tracker-targets";
import { CaseTracker } from "./case-tracker";
import { NpsCalculator } from "./nps-calculator";
import { ProductivityCalculator, type CalculatorSkill } from "./productivity-calculator";

const NPS_TARGET = 70;

function Delta({ delta, improved, kpiCode }: { delta: number | null; improved: boolean | null; kpiCode: string }) {
  if (delta === null) return <span className="text-muted">—</span>;
  if (Math.abs(delta) < 0.005) return <span className="text-muted">no change</span>;

  const tone = improved ? "text-pass" : "text-fail";
  return (
    <span className={`font-mono tabular-nums ${tone}`}>
      {delta > 0 ? "+" : "−"}
      {formatMetric(Math.abs(delta), kpiCode)}
    </span>
  );
}

/**
 * An agent's own numbers: the month to date beside the month before it, plus
 * the two calculators they use to plan the rest of the month.
 */
export default async function MyStatsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");

  const employee = await getOwnEmployee(user.employeeEid);
  if (!employee) {
    return (
      <>
        <PageBand title="My stats" subtitle="Your month to date" />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <EmptyState
              title="Account not linked"
              description="An administrator needs to link this account to an employee ID before your own performance appears here."
            />
          </Card>
        </main>
      </>
    );
  }

  // Anchor on the latest day with data rather than today: an agent opening
  // this on the 1st should still see the month the data is actually in.
  const range = await getFactDateRange();
  const anchor = range?.last ?? new Date().toISOString().slice(0, 10);

  // The tracker's own "today" is the real calendar day, not the anchor above:
  // it is a live day tracker, and the anchor deliberately lags to the last day
  // with imported data.
  const today = new Date().toISOString().slice(0, 10);

  const [{ period, previous, rows }, skills, trackerSkills] = await Promise.all([
    getMonthComparison(employee.id, anchor),
    db.select().from(skillReferences).where(eq(skillReferences.active, true)).orderBy(asc(skillReferences.sortOrder)),
    getTrackerSkills(employee.id, today),
  ]);
  const nps = await getNpsBreakdown(employee.id, period);

  const calculatorSkills: CalculatorSkill[] = skills.map((s) => ({
    code: s.code,
    name: s.name,
    target: s.target,
    metric: s.metric,
    lowerIsBetter: s.lowerIsBetter,
    thresholds: { r1: s.r1, r2: s.r2, r3: s.r3, r4: s.r4, r5: s.r5 },
  }));

  return (
    <>
      <PageBand title="My stats" subtitle={`${employee.name} · ${period.label}`} />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* First, and deliberately: this is the surface an agent has open
            through the shift, while everything below it is a once-a-day
            glance at numbers that only move when a workbook is imported. */}
        {trackerSkills.length > 0 && (
          <CaseTracker
            employeeId={employee.id}
            employeeName={employee.name}
            skills={trackerSkills}
            today={today}
          />
        )}

        <Card>
          <CardHeader
            title="Month to date by KPI"
            subtitle={`${period.label} compared with ${previous.label}`}
          />
          {rows.length === 0 ? (
            <EmptyState
              title="No data yet this month"
              description="Your KPIs appear here once this month's performance data has been imported."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                      KPI
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                      {period.label}
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                      {previous.label}
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                      Change
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                      Target
                    </th>
                    <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                      Sample
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.kpiCode} className="border-b-2 border-line last:border-0">
                      <td className="px-6 py-2.5 font-medium text-ink">{row.kpiName}</td>
                      <td
                        className={`px-3 py-2.5 font-mono font-semibold tabular-nums ${metricTone(row.status)}`}
                      >
                        {formatMetric(row.current, row.kpiCode)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted tabular-nums">
                        {formatMetric(row.previous, row.kpiCode)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Delta delta={row.delta} improved={row.improved} kpiCode={row.kpiCode} />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted tabular-nums">
                        {formatMetric(row.target, row.kpiCode)}
                      </td>
                      <td className="px-6 py-2.5 font-mono text-xs text-muted tabular-nums">
                        {row.sampleSize || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Productivity calculator"
            subtitle="What cases and hours would rate — the same PAR curve your imported data is scored with"
          />
          <ProductivityCalculator skills={calculatorSkills} />
        </Card>

        <Card>
          <CardHeader
            title="NPS calculator"
            subtitle={`Your response mix this month, and what it takes to reach ${NPS_TARGET}`}
          />
          <NpsCalculator mtd={nps} target={NPS_TARGET} monthLabel={period.label} />
        </Card>
      </main>
    </>
  );
}

import { redirect } from "next/navigation";
import { ChartFrame } from "@/components/charts";
import { Card, CardHeader, EmptyState, PageBand, StatCard } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { summarizeMine } from "@/lib/quality/my-scores";
import { PASS_THRESHOLD } from "@/lib/quality/scoring";
import { getMyQualityScores } from "@/lib/queries/quality";
import { CountBars } from "../quality/analysis/analysis-charts";
import { MyAuditsTable } from "./my-audits-table";
import { ScoreTrend } from "./score-trend";

const TONE = { pass: "pass", ink: "default", fail: "fail" } as const;

/**
 * An agent's own quality audits: how they are trending, what keeps coming
 * up, and each audit in full. Read-only apart from acknowledging a review.
 */
export default async function MyQualityScoresPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role !== "agent") redirect("/quality");

  const data = await getMyQualityScores(user);
  const band = <PageBand title="My Quality Scores" subtitle="Every quality audit your team lead has completed on your calls, and how you're trending" />;

  if (!data) {
    return (
      <>
        {band}
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <EmptyState
              title="Account not linked"
              description="An administrator needs to link this account to an employee ID before your audits appear here."
            />
          </Card>
        </main>
      </>
    );
  }

  const summary = summarizeMine(data.audits);

  return (
    <>
      {band}
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {summary.kpis.map((kpi) => (
            <StatCard key={kpi.label} label={kpi.label} value={kpi.value} tone={TONE[kpi.tone]} />
          ))}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <ChartFrame title="Score trend" subtitle={`Each audit in order · the dashed line is the ${PASS_THRESHOLD}% pass benchmark · red points had findings`}>
              <ScoreTrend points={summary.trend} />
            </ChartFrame>
          </div>
          <div className="lg:col-span-2">
            <ChartFrame title="Areas to focus on" subtitle="Your most frequent findings across your audits">
              <CountBars rows={summary.focus} tone="fail" emptyMessage="No recurring findings — nice work." />
            </ChartFrame>
          </div>
        </div>

        <Card>
          <CardHeader
            title="Audit history"
            subtitle={data.audits.length === 0 ? "No audits yet" : `${data.audits.length} audit${data.audits.length === 1 ? "" : "s"} · click a row for the detail`}
          />
          {data.audits.length === 0 ? (
            <EmptyState title="No audits yet" description="Audits your team lead completes on your calls and cases appear here." />
          ) : (
            <MyAuditsTable audits={data.audits} />
          )}
        </Card>
      </main>
    </>
  );
}

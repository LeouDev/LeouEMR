import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui";
import { canManageActionItems } from "@/lib/auth/scope";
import { getRampBoard } from "@/lib/queries/ramp";
import { LAST_STAGE, isNesting } from "@/lib/ramp/engine";
import { requireRampUser, todayIso } from "./access";
import { RampBand, RampTabs } from "./ramp-tabs";
import { ClearRampButton, RampForm } from "./ramp-form";
import { RampDateEditor } from "./ramp-date-editor";
import { ReapplyAllButton } from "./reapply-all-button";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/**
 * New-hire ramp: who is currently onboarding, and what their target is
 * this week — Nesting through Week 8, converging to the skill's standard
 * target, matching how the previous spreadsheet-driven process worked.
 *
 * Setting a start date here is what makes it real: the import pipeline
 * applies the matching week's target automatically from then on (see
 * loadRampTargets), replacing a per-row target someone would otherwise
 * have to keep editing in the source file by hand every week.
 *
 * How past cohorts actually progressed is the other tab (./progression).
 */
export default async function RampPage() {
  const user = await requireRampUser();
  const canEdit = canManageActionItems(user);
  const board = await getRampBoard(user, todayIso());

  const nesting = board.rows.filter((r) => isNesting(r.stage)).length;
  const completingThisWeek = board.rows.filter((r) => r.stage === LAST_STAGE).length;

  return (
    <>
      <RampBand />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <RampTabs active="board" />

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Currently ramping" value={board.rows.length} />
          <StatCard label="In Nesting" value={nesting} hint="Their first two weeks" />
          <StatCard
            label="Completing this week"
            value={completingThisWeek}
            tone={completingThisWeek > 0 ? "pass" : "default"}
            hint="Week 8 — standard target applies after"
          />
        </div>

        <Card>
          <CardHeader
            title="Board"
            subtitle={
              board.rows.length === 0
                ? "Nobody currently ramping"
                : "Ordered by stage — Nesting first, closest to standard last"
            }
            action={canEdit && board.rows.length > 0 ? <ReapplyAllButton /> : undefined}
          />

          {board.rows.length === 0 ? (
            <EmptyState
              title="Nobody currently ramping"
              description="Start one below when a new hire begins nesting."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className={`${HEAD} px-6`}>Employee</th>
                    <th className={HEAD}>Skill</th>
                    <th className={HEAD}>Stage</th>
                    <th className={HEAD}>Target this week</th>
                    <th className={HEAD}>Nesting started</th>
                    {canEdit && <th className={`${HEAD} px-6`} />}
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <tr
                      key={`${row.employeeId}|${row.skillReferenceId}`}
                      className="border-b-2 border-line last:border-0 hover:bg-cream/60"
                    >
                      <td className="px-6 py-2.5 font-medium text-ink">
                        {row.employeeName}
                        <span className="ml-2 font-mono text-xs text-muted">{row.eid}</span>
                      </td>
                      <td className="px-3 py-2.5 text-muted">{row.skillName}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`px-2 py-1 text-[11px] font-bold uppercase ${
                            row.stage === LAST_STAGE ? "bg-pass-bg text-pass" : "bg-orange-brand-100 text-ink"
                          }`}
                        >
                          {row.stageLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-ink">{row.target}</td>
                      {canEdit ? (
                        <td className="px-3 py-2.5">
                          <RampDateEditor
                            employeeId={row.employeeId}
                            skillReferenceId={row.skillReferenceId}
                            rampStartWeek={row.rampStartWeek}
                          />
                        </td>
                      ) : (
                        <td className="px-3 py-2.5 font-mono text-xs text-muted">{row.rampStartWeek}</td>
                      )}
                      {canEdit && (
                        <td className="px-6 py-2.5">
                          <ClearRampButton employeeId={row.employeeId} skillReferenceId={row.skillReferenceId} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canEdit &&
            (board.eligibleEmployees.length === 0 || board.skills.length === 0 ? (
              <p className="border-t-2 border-ink px-6 py-6 text-sm text-muted">
                {board.eligibleEmployees.length === 0
                  ? "No employees in your scope."
                  : "No active skills are configured."}
              </p>
            ) : (
              <RampForm employees={board.eligibleEmployees} skills={board.skills} />
            ))}
        </Card>
      </main>
    </>
  );
}

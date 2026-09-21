import { redirect } from "next/navigation";
import { EmptyState, PageBand, StatCard } from "@/components/ui";
import { canManageActionItems } from "@/lib/auth/scope";
import { isSupportRole } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { getRampBoard } from "@/lib/queries/ramp";
import { getRampProgression } from "@/lib/queries/ramp-progression";
import { employeeScope } from "@/lib/auth/scope";
import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";
import { LAST_STAGE, isNesting } from "@/lib/ramp/engine";
import { ClearRampButton, RampForm } from "./ramp-form";
import { RampDateEditor } from "./ramp-date-editor";
import { ReapplyAllButton } from "./reapply-all-button";
import { CollapsibleCard } from "./collapsible-card";
import { ProgressionBoard } from "./progression-board";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/** Today's date as YYYY-MM-DD, so the board reflects "right now" rather than a filtered period. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * New-hire ramp: who is currently onboarding, and what their target is
 * this week — Nesting through Week 8, converging to the skill's standard
 * target, matching how the previous spreadsheet-driven process worked.
 *
 * Setting a start date here is what makes it real: the import pipeline
 * applies the matching week's target automatically from then on (see
 * loadRampTargets), replacing a per-row target someone would otherwise
 * have to keep editing in the source file by hand every week.
 */
export default async function RampPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  // A hidden tab is not a permission check; this is a leader tool with
  // nothing in it for an agent to see about themselves or anyone else.
  if (user.role === "agent" || isSupportRole(user)) redirect("/dashboard");

  const canEdit = canManageActionItems(user);
  // Organisation-wide and cached, then narrowed here: the progression is one
  // answer for everybody and computing it per viewer is what the cache
  // exists to prevent (see lib/queries/ramp-progression.ts).
  const scope = employeeScope(user);
  const [board, everyTeam, mine] = await Promise.all([
    getRampBoard(user, todayIso()),
    getRampProgression(),
    scope === null
      ? Promise.resolve([])
      : db
          .select({ supervisor: employees.supervisorName })
          .from(employees)
          .where(scope === "all" ? undefined : scope),
  ]);
  const visible = new Set(mine.map((r) => r.supervisor ?? "Unassigned"));
  const teams = everyTeam.filter((team) => visible.has(team.supervisor));

  const nesting = board.rows.filter((r) => isNesting(r.stage)).length;
  const completingThisWeek = board.rows.filter((r) => r.stage === LAST_STAGE).length;

  return (
    <>
      <PageBand title="New-Hire Ramp" subtitle="Two nesting weeks, then Week 1 through Week 8, to the standard target" />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Currently ramping" value={board.rows.length} />
          <StatCard label="In Nesting" value={nesting} hint="Their first two weeks" />
          <StatCard
            label="Completing this week"
            value={completingThisWeek}
            tone={completingThisWeek > 0 ? "pass" : "default"}
            hint="Week 8 — standard target applies after"
          />
        </div>

        <CollapsibleCard
          id="ramp:progression"
          title="Progression by stage"
          subtitle="Every ramp on record, averaged per team — open a team for its agents, then a figure for what the supervisor wrote"
          action={
            teams.length > 0 ? (
              <span className="flex items-center gap-2">
                {/* Plain links, not buttons: a download is a navigation, and
                    this way it works with a middle click and a right click
                    like every other file in the app. */}
                <a
                  href="/ramp/export"
                  className="border-2 border-ink px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-orange-brand hover:text-orange-brand"
                >
                  CSV
                </a>
                <a
                  href="/ramp/export?format=xlsx"
                  className="border-2 border-ink px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-orange-brand hover:text-orange-brand"
                >
                  Excel
                </a>
              </span>
            ) : undefined
          }
        >
          <ProgressionBoard teams={teams} />
        </CollapsibleCard>

        <CollapsibleCard
          id="ramp:board"
          title="Board"
          subtitle={
            board.rows.length === 0
              ? "Nobody currently ramping"
              : "Ordered by stage — Nesting first, closest to standard last"
          }
          action={canEdit && board.rows.length > 0 ? <ReapplyAllButton /> : undefined}
        >
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
        </CollapsibleCard>
      </main>
    </>
  );
}

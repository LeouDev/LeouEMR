import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  kpiDefinitions,
  skillRampSchedules,
  skillReferences,
  weeklyMetricResults,
} from "@/lib/db/schema";
import { applySourceTarget, evaluateKpi } from "@/lib/kpi-engine/evaluate";
import type { KpiDefinition } from "@/lib/kpi-engine/types";
import { runIssueEngineForWeeks } from "@/lib/action-item-engine/persistence";
import { rampStageForWeek } from "./engine";

/** The KPI a skill's ramp adjusts — an AHT skill's ramp never touches CPH, and vice versa. */
async function loadRampKpi(
  skillReferenceId: string,
): Promise<{ id: string; definition: KpiDefinition; skillTarget: number } | null> {
  const [skill] = await db
    .select({ target: skillReferences.target, lowerIsBetter: skillReferences.lowerIsBetter })
    .from(skillReferences)
    .where(eq(skillReferences.id, skillReferenceId))
    .limit(1);
  if (!skill) return null;

  const [row] = await db
    .select()
    .from(kpiDefinitions)
    .where(eq(kpiDefinitions.code, skill.lowerIsBetter ? "AHT" : "CPH"))
    .limit(1);
  if (!row) return null;

  return {
    id: row.id,
    skillTarget: skill.target,
    definition: {
      code: row.code,
      name: row.name,
      type: row.type,
      direction: row.direction,
      target: row.target ?? undefined,
      warningThreshold: row.warningThreshold ?? undefined,
      failureThreshold: row.failureThreshold ?? undefined,
      rangeMin: row.rangeMin ?? undefined,
      rangeMax: row.rangeMax ?? undefined,
      expected: row.expectedBoolean ?? undefined,
    },
  };
}

/** Applies `resolveTarget` to each stored row, updates what changed, and replays the affected weeks. */
async function applyAndReplay(
  employeeId: string,
  kpiId: string,
  definition: KpiDefinition,
  resolveTarget: (weekStart: string) => number | undefined,
): Promise<{ weeksCorrected: number }> {
  const rows = await db
    .select()
    .from(weeklyMetricResults)
    .where(and(eq(weeklyMetricResults.employeeId, employeeId), eq(weeklyMetricResults.kpiId, kpiId)));

  const affectedWeeks = new Set<string>();
  const changes: Array<{ id: string; target: number; status: "pass" | "warning" | "fail" }> = [];
  for (const row of rows) {
    const target = resolveTarget(row.weekStart);
    if (target === undefined || target === row.targetValue) continue;

    const effective = applySourceTarget(definition, target);
    const status = evaluateKpi(row.actualValue, effective).status.toLowerCase() as
      | "pass"
      | "warning"
      | "fail";

    changes.push({ id: row.id, target, status });
    affectedWeeks.add(row.weekStart);
  }

  // One statement for every changed week rather than one round trip per
  // row. This runs on the "Start ramp" click, after weeks of data may
  // already be imported: a new hire eight weeks in used to pay eight
  // sequential UPDATEs to a remote pooled database before the button
  // came back, each one a full round trip. Same VALUES-join shape as
  // applyUpdates in the action-item engine.
  if (changes.length > 0) {
    const values = sql.join(
      changes.map((c) => sql`(${c.id}::uuid, ${c.target}::numeric, ${c.status}::kpi_status)`),
      sql`, `,
    );
    await db.execute(sql`
      update ${weeklyMetricResults} as w set
        target_value = v.target_value,
        status = v.status
      from (values ${values}) as v(id, target_value, status)
      where w.id = v.id
    `);
  }

  if (affectedWeeks.size > 0) {
    await runIssueEngineForWeeks([...affectedWeeks]);
  }
  return { weeksCorrected: affectedWeeks.size };
}

/**
 * Corrects already-imported weeks after a ramp assignment is set or changed.
 *
 * Setting a ramp assignment only changes how the *next* import resolves a
 * target — the aggregator applies it at aggregation time (see
 * loadRampTargets), and nothing re-runs that for a week already committed.
 * In practice a supervisor often sets ramp a few days into a new hire's
 * first week, after that week's file has already been imported without it,
 * which would otherwise leave a wrong target sitting there until the next
 * weekly import quietly fixes it. This closes that gap immediately instead.
 *
 * Deliberately narrow: it only touches the standalone weekly CPH/AHT result
 * (weeklyMetricResults) and the action items derived from it. The PAR/MBO
 * production rate is computed fresh from skill_facts at import time and is
 * not stored per-target the way weeklyMetricResults is, so an
 * already-committed week's production rate and MBO result are corrected by
 * the next import, not by this — re-deriving those from daily facts on
 * demand is a larger, separate piece of work than "set a ramp assignment"
 * should silently take on.
 */
export async function reapplyRampToStoredWeeks(
  employeeId: string,
  skillReferenceId: string,
  rampStartWeek: string,
): Promise<{ weeksCorrected: number }> {
  const kpi = await loadRampKpi(skillReferenceId);
  if (!kpi) return { weeksCorrected: 0 };

  const schedule = await db
    .select({ stage: skillRampSchedules.stage, target: skillRampSchedules.target })
    .from(skillRampSchedules)
    .where(eq(skillRampSchedules.skillReferenceId, skillReferenceId));
  if (schedule.length === 0) return { weeksCorrected: 0 };
  const targetByStage = new Map(schedule.map((s) => [s.stage, s.target]));

  return applyAndReplay(employeeId, kpi.id, kpi.definition, (weekStart) => {
    const stage = rampStageForWeek(rampStartWeek, weekStart);
    return stage === null ? undefined : targetByStage.get(stage);
  });
}

/**
 * Restores the skill's own steady-state target on stored weeks that a since-
 * removed ramp assignment had adjusted — the mirror image of
 * reapplyRampToStoredWeeks, run when a supervisor clears an assignment
 * rather than replaces it.
 *
 * Conservative by necessity: a ramp target and a genuine per-row target from
 * the source file share the same targetValue column by design (one
 * evaluation path for both), so a row that happens to carry a non-ramp
 * source target indistinguishable from a ramp one would also be reset here.
 * Acceptable because clearing an assignment is an immediate undo of a
 * mistake, not a routine action days or weeks later — the next import
 * still corrects anything this misses.
 */
export async function revertRampOnStoredWeeks(
  employeeId: string,
  skillReferenceId: string,
): Promise<{ weeksCorrected: number }> {
  const kpi = await loadRampKpi(skillReferenceId);
  if (!kpi) return { weeksCorrected: 0 };

  return applyAndReplay(employeeId, kpi.id, kpi.definition, () => kpi.skillTarget);
}

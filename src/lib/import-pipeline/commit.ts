import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  employees,
  importBatches,
  kpiDefinitions,
  weeklyMetricResults,
} from "@/lib/db/schema";
import { evaluateKpi } from "@/lib/kpi-engine/evaluate";
import type { KpiDefinition } from "@/lib/kpi-engine/types";
import { runIssueEngineForWeeks } from "@/lib/action-item-engine/persistence";
import type { ParseResult } from "./types";

export interface CommitSummary {
  employeesCreated: number;
  employeesUpdated: number;
  metricsWritten: number;
  metricsSkippedNoKpi: string[];
  weeks: string[];
  issuesOpened: number;
  issuesUpdated: number;
}

/**
 * Persists a parsed workbook and runs the downstream engines.
 *
 * Order matters: employees must exist before metrics can reference them,
 * metrics before KPI evaluation, and evaluation before the action-item
 * engine can decide what opens, continues or resolves.
 */
export async function commitImport(
  parsed: ParseResult,
  options: { importBatchId: string },
): Promise<CommitSummary> {
  const employeeIdByEid = await upsertEmployees(parsed);
  const definitions = await loadKpiDefinitions();

  const missingKpis = new Set<string>();
  const rows: Array<typeof weeklyMetricResults.$inferInsert> = [];

  for (const metric of parsed.metrics) {
    const employeeId = employeeIdByEid.get(metric.eid);
    const definition = definitions.get(metric.kpiCode);

    if (!employeeId) continue;
    if (!definition) {
      missingKpis.add(metric.kpiCode);
      continue;
    }

    // A target carried by the source data (CPH/AHT) wins over the KPI
    // definition's global threshold, because those targets are per employee.
    const effective = applySourceTarget(definition.definition, metric.targetValue);
    const evaluation = evaluateKpi(metric.actualValue, effective);

    rows.push({
      employeeId,
      kpiId: definition.id,
      weekStart: metric.weekStart,
      weekEnd: metric.weekEnd,
      actualValue: metric.actualValue,
      targetValue: metric.targetValue ?? effective.target ?? null,
      status: evaluation.status.toLowerCase() as "pass" | "warning" | "fail",
      sampleSize: metric.sampleSize,
      sourceImportId: options.importBatchId,
    });
  }

  if (rows.length > 0) {
    // Re-importing a week replaces that week's computed value rather than
    // duplicating it; prior weeks are never touched.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(weeklyMetricResults)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: [
            weeklyMetricResults.employeeId,
            weeklyMetricResults.kpiId,
            weeklyMetricResults.weekStart,
          ],
          set: {
            actualValue: sql`excluded.actual_value`,
            targetValue: sql`excluded.target_value`,
            status: sql`excluded.status`,
            sampleSize: sql`excluded.sample_size`,
            sourceImportId: sql`excluded.source_import_id`,
          },
        });
    }
  }

  const engineResult = await runIssueEngineForWeeks(parsed.weeks);

  await db
    .update(importBatches)
    .set({
      status: "committed",
      rowCounts: {
        employees: parsed.employees.length,
        metrics: rows.length,
        weeks: parsed.weeks,
        sheets: parsed.sheets,
      },
    })
    .where(eq(importBatches.id, options.importBatchId));

  return {
    ...employeeIdByEid.stats,
    metricsWritten: rows.length,
    metricsSkippedNoKpi: [...missingKpis],
    weeks: parsed.weeks,
    issuesOpened: engineResult.opened,
    issuesUpdated: engineResult.updated,
  };
}

/** Overrides a KPI definition's thresholds with a per-row target from the source. */
function applySourceTarget(definition: KpiDefinition, sourceTarget?: number): KpiDefinition {
  if (sourceTarget === undefined || !Number.isFinite(sourceTarget)) return definition;

  // The source supplies the target itself, so the pass/fail line moves with
  // it. Warning bands keep their configured offset relative to the target.
  const offset =
    definition.warningThreshold !== undefined && definition.failureThreshold !== undefined
      ? definition.warningThreshold - definition.failureThreshold
      : undefined;

  return {
    ...definition,
    target: sourceTarget,
    failureThreshold: sourceTarget,
    warningThreshold: offset === undefined ? undefined : sourceTarget + offset,
  };
}

type EmployeeIdMap = Map<string, string> & {
  stats: { employeesCreated: number; employeesUpdated: number };
};

async function upsertEmployees(parsed: ParseResult): Promise<EmployeeIdMap> {
  const map = new Map<string, string>() as EmployeeIdMap;
  map.stats = { employeesCreated: 0, employeesUpdated: 0 };

  if (parsed.employees.length === 0) return map;

  const eids = parsed.employees.map((e) => e.eid);
  const existing = await db
    .select({ id: employees.id, eid: employees.eid })
    .from(employees)
    .where(inArray(employees.eid, eids));

  const existingByEid = new Map(existing.map((row) => [row.eid, row.id]));

  const values = parsed.employees.map((employee) => ({
    eid: employee.eid,
    name: employee.name,
    supervisorEid: employee.supervisorEid ?? null,
    supervisorName: employee.supervisorName ?? null,
    managerName: employee.managerName ?? null,
    site: employee.site ?? null,
    skillType: employee.skillType ?? null,
    updatedAt: new Date(),
  }));

  const CHUNK = 500;
  const inserted: Array<{ id: string; eid: string }> = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const returned = await db
      .insert(employees)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: employees.eid,
        set: {
          name: sql`excluded.name`,
          supervisorEid: sql`excluded.supervisor_eid`,
          supervisorName: sql`excluded.supervisor_name`,
          managerName: sql`excluded.manager_name`,
          site: sql`excluded.site`,
          skillType: sql`excluded.skill_type`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning({ id: employees.id, eid: employees.eid });
    inserted.push(...returned);
  }

  for (const row of inserted) map.set(row.eid, row.id);
  map.stats.employeesUpdated = existingByEid.size;
  map.stats.employeesCreated = inserted.length - existingByEid.size;

  return map;
}

async function loadKpiDefinitions() {
  const rows = await db.select().from(kpiDefinitions).where(eq(kpiDefinitions.active, true));

  return new Map(
    rows.map((row) => [
      row.code,
      {
        id: row.id,
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
        } satisfies KpiDefinition,
      },
    ]),
  );
}

/** Looks up an existing employee id by EID, for callers outside the import flow. */
export async function findEmployeeByEid(eid: string) {
  const [row] = await db.select().from(employees).where(and(eq(employees.eid, eid))).limit(1);
  return row ?? null;
}

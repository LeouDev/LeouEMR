import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  employeeAssignments,
  employees,
  importBatches,
  kpiDefinitions,
  metricFacts,
  npsFacts,
  qualityFacts,
  skillFacts,
  skillReferences,
  weeklyMetricResults,
} from "@/lib/db/schema";
import { applySourceTarget, evaluateKpi } from "@/lib/kpi-engine/evaluate";
import {
  type Assignment,
  type MasterlistMonth,
  type OrgWeek,
  collapseWeeks,
  spliceWeeklyAssignments,
} from "@/lib/org/assignments";
import type { KpiDefinition } from "@/lib/kpi-engine/types";
import { runIssueEngineForWeeks } from "@/lib/action-item-engine/persistence";
import { combine } from "@/lib/queries/period-metrics";
import { syncEmployeeSnapshots } from "@/lib/org/snapshot";
import { masterlistMonthFromBatch } from "./masterlist-months";
import { computeParMetrics } from "./par-scoring";
import type { ParseResult } from "./types";

export interface CommitSummary {
  employeesCreated: number;
  employeesUpdated: number;
  metricsWritten: number;
  metricsSkippedNoKpi: string[];
  weeks: string[];
  issuesOpened: number;
  issuesUpdated: number;
  /** Issues whose already-folded history no longer matched corrected data and were rebuilt. */
  issuesCorrected: number;
  /** Same situation, left for a person to review — see canAutoReplay. */
  issuesFlagged: number;
  /** Skill labels present in the data with no configured reference. */
  unmatchedSkills: string[];
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
  // Before anything is measured: record who each person reported to during the
  // weeks this file covers, so the roll-ups can attribute results to the
  // supervisor of record rather than to whoever holds them today.
  await persistAssignments(parsed, employeeIdByEid, options.importBatchId);
  await ensureSkillKpis();
  const definitions = await loadKpiDefinitions();

  const missingKpis = new Set<string>();
  // Built from parsed.metrics — every one of these has a daily fact behind
  // it in metric_facts, so its actualValue gets corrected below rather than
  // trusted as-is. par.metrics (PAR/MBO/DPU/DPO) has no such fact table to
  // re-derive from and is written as computed.
  const factBackedRows: Array<typeof weeklyMetricResults.$inferInsert> = [];
  const derivedRows: Array<typeof weeklyMetricResults.$inferInsert> = [];

  // PAR/MBO ratings are derived rather than measured, so they are computed
  // here from the per-skill totals and appended to the measured metrics.
  const par = await computeParMetrics(parsed.skillWeeks, parsed.qualityWeeks);

  for (const [metrics, target] of [
    [parsed.metrics, factBackedRows],
    [par.metrics, derivedRows],
  ] as const) {
    for (const metric of metrics) {
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

      target.push({
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
  }

  // Facts first: metric_facts merges safely across imports (upserted per
  // employee+kpi+day), which is exactly what weekly_metric_results is not —
  // a week's row here used to be whatever THIS import alone computed for it,
  // silently overwriting a more complete prior total the moment two imports
  // carried a non-identical view of the same week (see reconcileFactBackedRows).
  await persistFacts(parsed, definitions, options.importBatchId, employeeIdByEid);
  await reconcileFactBackedRows(factBackedRows, definitions);

  const rows = [...factBackedRows, ...derivedRows];

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
    unmatchedSkills: par.unmatchedSkills,
    weeks: parsed.weeks,
    issuesOpened: engineResult.opened,
    issuesUpdated: engineResult.updated,
    issuesCorrected: engineResult.corrected,
    issuesFlagged: engineResult.flagged,
  };
}

/**
 * Stores the daily facts behind each metric.
 *
 * The weekly ledger drives the action-item engine, but a reporting period
 * other than a week has to be re-aggregated from source grain — most of
 * these measures cannot be averaged across periods.
 */
async function persistFacts(
  parsed: ParseResult,
  definitions: Map<string, { id: string }>,
  importBatchId: string,
  employeeIdByEid: Map<string, string>,
) {
  const CHUNK = 1000;

  const metricRows = parsed.metricFacts
    .map((fact) => {
      const employeeId = employeeIdByEid.get(fact.eid);
      const kpi = definitions.get(fact.kpiCode);
      if (!employeeId || !kpi) return null;
      return {
        employeeId,
        kpiId: kpi.id,
        factDate: fact.factDate,
        numerator: fact.numerator,
        denominator: fact.denominator,
        sampleSize: fact.sampleSize,
        sourceImportId: importBatchId,
      };
    })
    .filter((r) => r !== null);

  for (let i = 0; i < metricRows.length; i += CHUNK) {
    await db
      .insert(metricFacts)
      .values(metricRows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [metricFacts.employeeId, metricFacts.kpiId, metricFacts.factDate],
        set: {
          numerator: sql`excluded.numerator`,
          denominator: sql`excluded.denominator`,
          sampleSize: sql`excluded.sample_size`,
          sourceImportId: sql`excluded.source_import_id`,
        },
      });
  }

  const skillRows = parsed.skillFacts
    .map((fact) => {
      const employeeId = employeeIdByEid.get(fact.eid);
      if (!employeeId) return null;
      return {
        employeeId,
        skillLabel: fact.skillLabel,
        factDate: fact.factDate,
        cases: fact.cases,
        hours: fact.hours,
        weightHours: fact.weightHours,
        prodWeight: fact.prodWeight,
        sourceImportId: importBatchId,
      };
    })
    .filter((r) => r !== null);

  for (let i = 0; i < skillRows.length; i += CHUNK) {
    await db
      .insert(skillFacts)
      .values(skillRows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [skillFacts.employeeId, skillFacts.skillLabel, skillFacts.factDate],
        set: {
          cases: sql`excluded.cases`,
          hours: sql`excluded.hours`,
          weightHours: sql`excluded.weight_hours`,
          prodWeight: sql`excluded.prod_weight`,
          sourceImportId: sql`excluded.source_import_id`,
        },
      });
  }

  const qualityRows = parsed.qualityFacts
    .map((fact) => {
      const employeeId = employeeIdByEid.get(fact.eid);
      if (!employeeId) return null;
      return {
        employeeId,
        skillLabel: fact.skillLabel,
        factDate: fact.factDate,
        audits: fact.audits,
        imperfect: fact.imperfect,
        markdowns: fact.markdowns,
        sourceImportId: importBatchId,
      };
    })
    .filter((r) => r !== null);

  for (let i = 0; i < qualityRows.length; i += CHUNK) {
    await db
      .insert(qualityFacts)
      .values(qualityRows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [qualityFacts.employeeId, qualityFacts.skillLabel, qualityFacts.factDate],
        set: {
          audits: sql`excluded.audits`,
          imperfect: sql`excluded.imperfect`,
          markdowns: sql`excluded.markdowns`,
          sourceImportId: sql`excluded.source_import_id`,
        },
      });
  }

  const npsRows = parsed.npsFacts
    .map((fact) => {
      const employeeId = employeeIdByEid.get(fact.eid);
      if (!employeeId) return null;
      return {
        employeeId,
        factDate: fact.factDate,
        promoters: fact.promoters,
        passives: fact.passives,
        detractors: fact.detractors,
        sourceImportId: importBatchId,
      };
    })
    .filter((r) => r !== null);

  for (let i = 0; i < npsRows.length; i += CHUNK) {
    await db
      .insert(npsFacts)
      .values(npsRows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [npsFacts.employeeId, npsFacts.factDate],
        set: {
          promoters: sql`excluded.promoters`,
          passives: sql`excluded.passives`,
          detractors: sql`excluded.detractors`,
          sourceImportId: sql`excluded.source_import_id`,
        },
      });
  }
}

/**
 * Overwrites each row's actualValue/sampleSize/status in place, re-derived
 * from every metric_facts row for that employee+KPI+week rather than from
 * this import's own local rollup.
 *
 * A single import only ever sees the source rows it was handed — a workbook
 * covering a "partial" re-export of a week (missing an incident row a prior
 * import already recorded) still computes a self-consistent-looking weekly
 * total from what it has, and the old code trusted that total outright.
 * metric_facts doesn't have this problem (each day is its own upsert key,
 * so distinct days from different imports simply coexist), so re-summing
 * from it after facts are persisted is what actually reflects the complete
 * picture across every import that has ever touched this employee+KPI.
 */
async function reconcileFactBackedRows(
  rows: Array<typeof weeklyMetricResults.$inferInsert>,
  definitions: Map<string, { id: string; aggregation: string; definition: KpiDefinition }>,
): Promise<void> {
  if (rows.length === 0) return;

  const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
  const kpiIds = [...new Set(rows.map((r) => r.kpiId))];
  const aggregationByKpiId = new Map(
    [...definitions.values()].map((d) => [d.id, d.aggregation]),
  );
  const definitionByKpiId = new Map([...definitions.values()].map((d) => [d.id, d.definition]));

  // Bounded to the span of weeks actually being reconciled. Every row below
  // only ever looks at facts between its own weekStart and weekEnd, so
  // anything outside the union of those windows is loaded and then thrown
  // away — and without this bound that was EVERY fact ever recorded for
  // these employees and KPIs, a read that grows with the whole history on
  // every weekly import (roughly employees × KPIs × working days to date)
  // rather than with the size of the file being imported. The date-leading
  // index on metric_facts (0040) is what makes the bounded read cheap.
  const window = factWindow(rows);
  const facts = await db
    .select({
      employeeId: metricFacts.employeeId,
      kpiId: metricFacts.kpiId,
      factDate: metricFacts.factDate,
      numerator: metricFacts.numerator,
      denominator: metricFacts.denominator,
      sampleSize: metricFacts.sampleSize,
    })
    .from(metricFacts)
    .where(
      and(
        inArray(metricFacts.employeeId, employeeIds),
        inArray(metricFacts.kpiId, kpiIds),
        gte(metricFacts.factDate, window.start),
        lte(metricFacts.factDate, window.end),
      ),
    );

  const factsByPair = new Map<string, typeof facts>();
  for (const f of facts) {
    const key = `${f.employeeId}|${f.kpiId}`;
    const arr = factsByPair.get(key);
    if (arr) arr.push(f);
    else factsByPair.set(key, [f]);
  }

  for (const row of rows) {
    const aggregation = aggregationByKpiId.get(row.kpiId);
    const definition = definitionByKpiId.get(row.kpiId);
    if (!aggregation || !definition) continue;

    const pairFacts = factsByPair.get(`${row.employeeId}|${row.kpiId}`) ?? [];
    const inRange = pairFacts.filter((f) => f.factDate >= row.weekStart && f.factDate <= row.weekEnd);
    if (inRange.length === 0) continue; // this import's own row is all there is for this week

    const numerator = inRange.reduce((sum, f) => sum + f.numerator, 0);
    const denominator = inRange.reduce((sum, f) => sum + f.denominator, 0);
    const sampleSize = inRange.reduce((sum, f) => sum + (f.sampleSize ?? 0), 0);

    const correctActual = combine(aggregation, numerator, denominator);
    if (correctActual === null) continue;

    const effective = applySourceTarget(definition, row.targetValue ?? undefined);
    const evaluation = evaluateKpi(correctActual, effective);

    row.actualValue = correctActual;
    row.sampleSize = sampleSize;
    row.status = evaluation.status.toLowerCase() as "pass" | "warning" | "fail";
  }
}

/**
 * The inclusive date span covering every week in `rows` — the only range of
 * facts `reconcileFactBackedRows` can ever consult. Pure, so the bound can be
 * pinned down in a test rather than only trusted in production.
 */
export function factWindow(rows: Array<{ weekStart: string; weekEnd: string }>): {
  start: string;
  end: string;
} {
  let start = rows[0].weekStart;
  let end = rows[0].weekEnd;
  for (const row of rows) {
    if (row.weekStart < start) start = row.weekStart;
    if (row.weekEnd > end) end = row.weekEnd;
  }
  return { start, end };
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

/**
 * Records dated org history from the weeks this file states.
 *
 * The file is authoritative for exactly the weeks it covers for each person,
 * so that window is spliced into their existing history rather than appended
 * or wholesale replaced — which is what makes re-importing a month, or
 * uploading an older month after a newer one, safe. Months with a committed
 * masterlist are held authoritative over the file (loadMasterlistMonths).
 *
 * The delete and re-insert run in one transaction because a partial write
 * would leave someone with no history at all, which reads as "never assigned"
 * rather than as an error.
 */
async function persistAssignments(
  parsed: ParseResult,
  employeeIdByEid: Map<string, string>,
  importBatchId: string,
): Promise<void> {
  if (parsed.orgWeeks.length === 0) return;

  const byEmployee = new Map<string, OrgWeek[]>();
  for (const week of parsed.orgWeeks) {
    const employeeId = employeeIdByEid.get(week.eid);
    if (!employeeId) continue;
    byEmployee.set(employeeId, [...(byEmployee.get(employeeId) ?? []), week]);
  }
  if (byEmployee.size === 0) return;

  const employeeIds = [...byEmployee.keys()];
  const [existingRows, masterlistMonths] = await Promise.all([
    db.select().from(employeeAssignments).where(inArray(employeeAssignments.employeeId, employeeIds)),
    loadMasterlistMonths(),
  ]);

  const existingByEmployee = new Map<string, Assignment[]>();
  for (const row of existingRows) {
    existingByEmployee.set(row.employeeId, [
      ...(existingByEmployee.get(row.employeeId) ?? []),
      {
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        supervisorEid: row.supervisorEid,
        supervisorName: row.supervisorName,
        managerName: row.managerName,
        site: row.site,
        sourceImportId: row.sourceImportId,
      },
    ]);
  }

  const values: Array<typeof employeeAssignments.$inferInsert> = [];
  for (const [employeeId, weeks] of byEmployee) {
    const incoming = collapseWeeks(weeks).map((a) => ({ ...a, sourceImportId: importBatchId }));
    if (incoming.length === 0) continue;

    // The window this file speaks for, for this person specifically — someone
    // present in only two of four weeks is not evidence about the other two.
    const rangeStart = incoming[0].effectiveFrom;
    const rangeEnd = weeks.reduce((max, w) => (w.weekEnd > max ? w.weekEnd : max), weeks[0].weekEnd);

    const existing = (existingByEmployee.get(employeeId) ?? []).sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom),
    );

    for (const a of spliceWeeklyAssignments(existing, incoming, rangeStart, rangeEnd, masterlistMonths)) {
      values.push({
        employeeId,
        effectiveFrom: a.effectiveFrom,
        effectiveTo: a.effectiveTo,
        supervisorEid: a.supervisorEid,
        supervisorName: a.supervisorName,
        managerName: a.managerName,
        site: a.site,
        sourceImportId: a.sourceImportId ?? importBatchId,
      });
    }
  }

  const CHUNK = 500;
  await db.transaction(async (tx) => {
    await tx.delete(employeeAssignments).where(inArray(employeeAssignments.employeeId, employeeIds));
    for (let i = 0; i < values.length; i += CHUNK) {
      await tx.insert(employeeAssignments).values(values.slice(i, i + CHUNK));
    }
    // upsertEmployees wrote the file's own org columns onto the snapshot;
    // inside a masterlist month the history just spliced may say otherwise,
    // and the history is what the snapshot must follow.
    await syncEmployeeSnapshots(tx, employeeIds);
  });
}

/**
 * The months a committed masterlist is the complete roster for. Inside one
 * of these, a weekly file may not move or reopen anyone the masterlist
 * listed or closed — see spliceWeeklyAssignments. Without this the week
 * straddling a month boundary, imported right after the masterlist, put
 * its own (lagging) supervisor column back for the whole month and
 * reopened everyone the masterlist had marked attrited.
 */
async function loadMasterlistMonths(): Promise<MasterlistMonth[]> {
  const rows = await db
    .select({ id: importBatches.id, validationSummary: importBatches.validationSummary })
    .from(importBatches)
    .where(and(eq(importBatches.status, "committed"), sql`${importBatches.validationSummary} ->> 'kind' = 'masterlist'`));
  return rows.flatMap((row) => {
    const month = masterlistMonthFromBatch(row);
    return month ? [month] : [];
  });
}

/**
 * One KPI definition per skill reference (code `SKILL_<skill code>`), so a
 * skill's weekly result is evaluated, tracked and opened as a development
 * item like any KPI. Migration 0042 seeded them; this keeps them in step for
 * a skill added or renamed since, before the import looks the codes up.
 */
async function ensureSkillKpis(): Promise<void> {
  await db.execute(sql`
    insert into ${kpiDefinitions}
      (code, name, type, direction, target, generates_action_items, aggregation, skill_reference_id)
    select 'SKILL_' || upper(s.code), s.name, 'number'::kpi_type,
           (case when s.lower_is_better then 'lower_is_better' else 'higher_is_better' end)::kpi_direction,
           null, true, 'derived'::kpi_aggregation, s.id
    from ${skillReferences} s
    on conflict (skill_reference_id) do update
      set name = excluded.name, direction = excluded.direction
  `);
}

async function loadKpiDefinitions() {
  const rows = await db.select().from(kpiDefinitions).where(eq(kpiDefinitions.active, true));

  return new Map(
    rows.map((row) => [
      row.code,
      {
        id: row.id,
        aggregation: row.aggregation,
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

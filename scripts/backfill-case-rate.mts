/**
 * Fills the weekly ledger with case-rate rows for every week imported before
 * case rate became a KPI (migration 0041), from the per-skill daily facts —
 * the same formula the import now applies to each new week — and, on
 * request, lets the action-item engine open development items off them.
 *
 * Idempotent: a week that already has a case-rate row (from an import since
 * 0041, or an earlier run of this) is left exactly as it is.
 *
 *   npm run backfill:case-rate                        # report only
 *   npm run backfill:case-rate -- --apply             # write the ledger rows
 *   npm run backfill:case-rate -- --apply --open-items
 *     # also fold the new rows through the action-item engine, which opens
 *     # an item for each agent whose case rate failed in a backfilled week
 *     # (one per failure episode, exactly as it would have at import time;
 *     # episodes that then recovered and are past 60 days close on age in
 *     # the same run).
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { kpiDefinitions, skillFacts, weeklyMetricResults } from "../src/lib/db/schema";
import { runIssueEngineForWeeks } from "../src/lib/action-item-engine/persistence";
import { loadSkillReferences } from "../src/lib/import-pipeline/par-scoring";
import {
  CASE_RATE_KPI_CODE,
  blendCaseRate,
  type CaseRateSkillTotals,
} from "../src/lib/kpi-engine/case-rate";
import { applySourceTarget, evaluateKpi } from "../src/lib/kpi-engine/evaluate";
import { normalizeSkill } from "../src/lib/kpi-engine/quality-metrics";
import type { KpiDefinition } from "../src/lib/kpi-engine/types";
import { periodContaining } from "../src/lib/queries/period";

const apply = process.argv.includes("--apply");
const openItems = process.argv.includes("--open-items");

const [row] = await db
  .select()
  .from(kpiDefinitions)
  .where(eq(kpiDefinitions.code, CASE_RATE_KPI_CODE))
  .limit(1);
if (!row) {
  console.error("No CASE_RATE KPI definition: apply migration 0041 first (npm run db:migrate).");
  process.exit(1);
}
const definition: KpiDefinition = {
  code: row.code,
  name: row.name,
  type: row.type,
  direction: row.direction,
  target: row.target ?? undefined,
  warningThreshold: row.warningThreshold ?? undefined,
  failureThreshold: row.failureThreshold ?? undefined,
};

const references = await loadSkillReferences();

// Per employee, skill and reporting week. Weeks run Saturday to Friday, so a
// fact belongs to the Saturday on or before it — checked against the app's
// own periodContaining below rather than trusted.
const weekStart = sql<string>`(${skillFacts.factDate} - ((extract(dow from ${skillFacts.factDate})::int + 1) % 7))::text`;
const facts = await db
  .select({
    employeeId: skillFacts.employeeId,
    skillLabel: skillFacts.skillLabel,
    weekStart,
    cases: sql<number>`sum(${skillFacts.cases})::double precision`,
    prodWeight: sql<number>`sum(${skillFacts.prodWeight})::double precision`,
    // The import that last touched the week — the row has to cite one.
    sourceImportId: sql<string>`(array_agg(${skillFacts.sourceImportId} order by ${skillFacts.factDate} desc))[1]`,
  })
  .from(skillFacts)
  .groupBy(skillFacts.employeeId, skillFacts.skillLabel, weekStart);

const byEmployeeWeek = new Map<
  string,
  { employeeId: string; weekStart: string; sourceImportId: string; skills: CaseRateSkillTotals[] }
>();
for (const fact of facts) {
  const ref = references.get(normalizeSkill(fact.skillLabel));
  if (ref?.metric !== "case_rate" || !(ref.target > 0)) continue;
  if (periodContaining("week", fact.weekStart).start !== fact.weekStart) {
    throw new Error(`Week bucketing disagrees with periodContaining for ${fact.weekStart}`);
  }
  const key = `${fact.employeeId}|${fact.weekStart}`;
  const entry = byEmployeeWeek.get(key) ?? {
    employeeId: fact.employeeId,
    weekStart: fact.weekStart,
    sourceImportId: fact.sourceImportId,
    skills: [],
  };
  entry.skills.push({ cases: fact.cases, prodWeight: fact.prodWeight, targetPerCase: ref.target });
  byEmployeeWeek.set(key, entry);
}

const existing = new Set(
  (
    await db
      .select({ employeeId: weeklyMetricResults.employeeId, weekStart: weeklyMetricResults.weekStart })
      .from(weeklyMetricResults)
      .where(eq(weeklyMetricResults.kpiId, row.id))
  ).map((r) => `${r.employeeId}|${r.weekStart}`),
);

const rows: Array<typeof weeklyMetricResults.$inferInsert> = [];
let skipped = 0;
for (const [key, entry] of byEmployeeWeek) {
  if (existing.has(key)) {
    skipped += 1;
    continue;
  }
  const blended = blendCaseRate(entry.skills);
  if (!blended) continue;
  const evaluation = evaluateKpi(blended.rate, applySourceTarget(definition, blended.target));
  rows.push({
    employeeId: entry.employeeId,
    kpiId: row.id,
    weekStart: entry.weekStart,
    weekEnd: periodContaining("week", entry.weekStart).end,
    actualValue: blended.rate,
    targetValue: blended.target,
    status: evaluation.status.toLowerCase() as "pass" | "warning" | "fail",
    sampleSize: Math.round(blended.cases),
    sourceImportId: entry.sourceImportId,
  });
}

const weeks = [...new Set(rows.map((r) => r.weekStart))].sort();
const failing = rows.filter((r) => r.status === "fail");
const employeesFailing = new Set(failing.map((r) => r.employeeId));
console.log(`Case-rate weeks already in the ledger (left alone): ${skipped}`);
console.log(`Rows to write: ${rows.length} across ${weeks.length} weeks (${weeks[0] ?? "-"} to ${weeks.at(-1) ?? "-"}), ${new Set(rows.map((r) => r.employeeId)).size} employees`);
console.log(`  of which failing: ${failing.length} weeks for ${employeesFailing.size} employees`);
if (!apply) {
  console.log("\nReport only. Re-run with --apply to write them" + (openItems ? "" : ", and --open-items to open development items off the failures") + ".");
  process.exit(0);
}

const CHUNK = 500;
for (let i = 0; i < rows.length; i += CHUNK) {
  await db.insert(weeklyMetricResults).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
}
console.log(`\nWrote ${rows.length} ledger rows.`);

if (openItems && weeks.length > 0) {
  const result = await runIssueEngineForWeeks(weeks);
  console.log(
    `Engine: ${result.opened} opened, ${result.updated} updated, ${result.completed} completed, ${result.agedOut} aged out, ${result.corrected} corrected, ${result.flagged} flagged`,
  );
} else if (weeks.length > 0) {
  console.log("Ledger only; re-run with --apply --open-items to open development items off these weeks.");
}

process.exit(0);

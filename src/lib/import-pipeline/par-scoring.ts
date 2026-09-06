import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  employeeRampAssignments,
  employees,
  skillAliases,
  skillRampSchedules,
  skillReferences,
} from "@/lib/db/schema";
import {
  computeSkillRating,
  computeSkillRatio,
  type RatingThresholds,
} from "@/lib/kpi-engine/par-mbo";
import { computeQualityTotals, normalizeSkill } from "@/lib/kpi-engine/quality-metrics";
import { LAST_STAGE, rampStageForWeek, weekForStage } from "@/lib/ramp/engine";
import type { AggregatedMetric, QualityWeek, SkillWeek } from "./types";

export const PAR_KPI_CODES = {
  PRODUCTION_RATE: "PRODUCTION_RATE",
  DPU: "DPU",
  DPO: "DPO",
  MBO: "MBO",
} as const;

/**
 * The MBO gates, matching the existing MBO2 app's isPass(): a production
 * rate at or above 2.99 and both quality measures at or above 95%.
 */
export const MBO_GATES = {
  productionRate: 2.99,
  dpu: 95,
  dpo: 95,
} as const;

interface SkillReference {
  code: string;
  name: string;
  target: number;
  metric: "cph" | "aht" | "case_rate";
  lowerIsBetter: boolean;
  attributesPerAudit: number;
  thresholds: RatingThresholds;
}

/**
 * Matches a source skill label to a configured skill reference.
 * The workbook writes skills as free text ("Fax", "PartD_Phones"), so this
 * compares on a normalized form rather than requiring an exact match.
 */
export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function loadSkillReferences(): Promise<Map<string, SkillReference>> {
  const rows = await db.select().from(skillReferences).where(eq(skillReferences.active, true));

  const byId = new Map<string, SkillReference>();
  const byKey = new Map<string, SkillReference>();
  for (const row of rows) {
    const reference: SkillReference = {
      code: row.code,
      name: row.name,
      target: row.target,
      metric: row.metric,
      lowerIsBetter: row.lowerIsBetter,
      attributesPerAudit: row.attributesPerAudit,
      thresholds: { r1: row.r1, r2: row.r2, r3: row.r3, r4: row.r4, r5: row.r5 },
    };
    byId.set(row.id, reference);
    byKey.set(normalize(row.code), reference);
    byKey.set(normalize(row.name), reference);
  }

  // Source labels that differ from the reference's own naming.
  const aliases = await db.select().from(skillAliases);
  for (const alias of aliases) {
    const reference = byId.get(alias.skillReferenceId);
    if (reference) byKey.set(normalize(alias.sourceLabel), reference);
  }

  return byKey;
}

/**
 * The measured value for one skill-week, per the skill's configured metric.
 * Case rate is weight-based and involves no hours at all.
 */
function measureSkill(
  metric: SkillReference["metric"],
  skill: { cases: number; hours: number; prodWeight: number },
): number | null {
  switch (metric) {
    case "aht":
      return skill.cases > 0 ? (skill.hours / skill.cases) * 3600 : null;
    case "case_rate":
      return skill.cases > 0 && skill.prodWeight > 0 ? skill.prodWeight / skill.cases : null;
    case "cph":
    default:
      return skill.hours > 0 ? skill.cases / skill.hours : null;
  }
}

/** Normalized skill key -> attributes per audit, for the DPO denominator. */
export async function loadAttributesBySkill(): Promise<Map<string, number>> {
  const rows = await db.select().from(skillReferences).where(eq(skillReferences.active, true));
  const map = new Map<string, number>();
  const byId = new Map<string, number>();
  for (const row of rows) {
    byId.set(row.id, row.attributesPerAudit);
    map.set(normalizeSkill(row.code), row.attributesPerAudit);
    map.set(normalizeSkill(row.name), row.attributesPerAudit);
  }

  const aliases = await db.select().from(skillAliases);
  for (const alias of aliases) {
    const attributes = byId.get(alias.skillReferenceId);
    if (attributes !== undefined) map.set(normalizeSkill(alias.sourceLabel), attributes);
  }

  return map;
}

export interface ParScoringResult {
  metrics: AggregatedMetric[];
  /** Skill labels in the data with no configured reference — their rating is not computed. */
  unmatchedSkills: string[];
}

/**
 * Computes the PAR/MBO production rate and DPU for each employee-week.
 *
 * The rating curve (R1-R5) comes from the skill reference, but the target
 * comes from the source row whenever it supplies one: the workbook carries
 * per-employee targets that differ from the skill default, and scoring a
 * ramping agent against the steady-state target would fail them unfairly.
 */
export async function computeParMetrics(
  skillWeeks: SkillWeek[],
  qualityWeeks: QualityWeek[],
): Promise<ParScoringResult> {
  const references = await loadSkillReferences();
  const metrics: AggregatedMetric[] = [];
  const unmatched = new Set<string>();
  const productionRates = new Map<string, number>();
  const qualityGates = new Map<string, { dpu: number; dpo: number | null }>();

  // Group each employee-week's skills so the rating can be hours-weighted.
  const byEmployeeWeek = new Map<string, SkillWeek[]>();
  for (const skill of skillWeeks) {
    const key = `${skill.eid}|${skill.weekStart}`;
    const list = byEmployeeWeek.get(key) ?? [];
    list.push(skill);
    byEmployeeWeek.set(key, list);
  }

  for (const [, skills] of byEmployeeWeek) {
    const scored = skills
      .map((skill) => {
        const reference = references.get(normalize(skill.skillType));
        if (!reference) {
          unmatched.add(skill.skillType);
          return null;
        }
        if (skill.hours <= 0 || skill.cases <= 0) return null;

        // The actual and the target must share units. A lower-is-better
        // skill is measured in seconds per case, so it needs the row's AHT
        // target; a higher-is-better one needs the cases-per-hour target.
        const target = reference.lowerIsBetter
          ? (skill.ahtTarget ?? reference.target)
          : (skill.cphTarget ?? reference.target);
        if (!target) return null;

        const actual = measureSkill(reference.metric, skill);
        if (actual === null) return null;

        const ratio = computeSkillRatio(actual, target, reference.lowerIsBetter);
        return {
          rating: computeSkillRating(ratio, reference.thresholds),
          // Weighted by scheduled hours, not the productive hours the rate
          // was measured over — see SkillWeek.weightHours.
          hours: skill.weightHours > 0 ? skill.weightHours : skill.hours,
          skill,
        };
      })
      .filter((entry) => entry !== null);

    if (scored.length === 0) continue;

    const totalHours = scored.reduce((sum, entry) => sum + entry.hours, 0);
    if (totalHours <= 0) continue;

    const finalRate = scored.reduce(
      (sum, entry) => sum + entry.rating * (entry.hours / totalHours),
      0,
    );

    const first = scored[0].skill;
    metrics.push({
      eid: first.eid,
      kpiCode: PAR_KPI_CODES.PRODUCTION_RATE as never,
      weekStart: first.weekStart,
      weekEnd: first.weekEnd,
      actualValue: finalRate,
      sampleSize: scored.length,
    });
    productionRates.set(`${first.eid}|${first.weekStart}`, finalRate);
  }

  const attributesBySkill = await loadAttributesBySkill();

  for (const week of qualityWeeks) {
    const records = Object.entries(week.bySkill).map(([skill, tally]) => ({
      skill,
      audits: tally.audits,
      markdowns: tally.markdowns,
      imperfect: tally.imperfect,
    }));

    const totals = computeQualityTotals(records, attributesBySkill);
    if (totals.dpu === null) continue;

    metrics.push({
      eid: week.eid,
      kpiCode: PAR_KPI_CODES.DPU as never,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      actualValue: totals.dpu,
      sampleSize: totals.audits,
    });

    if (totals.dpo !== null) {
      metrics.push({
        eid: week.eid,
        kpiCode: PAR_KPI_CODES.DPO as never,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        actualValue: totals.dpo,
        sampleSize: totals.attributes,
      });
    }

    qualityGates.set(`${week.eid}|${week.weekStart}`, { dpu: totals.dpu, dpo: totals.dpo });
  }

  // The composite MBO result. Every employee-week with any component is
  // scored on the share of gates met, so falling short of any one fails.
  const keys = new Set([...productionRates.keys(), ...qualityGates.keys()]);
  for (const key of keys) {
    const [eid, weekStart] = key.split("|");
    const rate = productionRates.get(key);
    const gates = qualityGates.get(key);

    const checks: boolean[] = [];
    if (rate !== undefined) checks.push(rate >= MBO_GATES.productionRate);
    if (gates) {
      checks.push(gates.dpu >= MBO_GATES.dpu);
      if (gates.dpo !== null) checks.push(gates.dpo >= MBO_GATES.dpo);
    }
    if (checks.length === 0) continue;

    const weekEnd = weekEndFor(skillWeeks, qualityWeeks, eid, weekStart);
    if (!weekEnd) continue;

    metrics.push({
      eid,
      kpiCode: PAR_KPI_CODES.MBO as never,
      weekStart,
      weekEnd,
      actualValue: (checks.filter(Boolean).length / checks.length) * 100,
      sampleSize: checks.length,
    });
  }

  return { metrics, unmatchedSkills: [...unmatched] };
}

function weekEndFor(
  skillWeeks: SkillWeek[],
  qualityWeeks: QualityWeek[],
  eid: string,
  weekStart: string,
): string | null {
  const skill = skillWeeks.find((s) => s.eid === eid && s.weekStart === weekStart);
  if (skill) return skill.weekEnd;
  const quality = qualityWeeks.find((q) => q.eid === eid && q.weekStart === weekStart);
  return quality?.weekEnd ?? null;
}

/**
 * Skill label to the formula that skill is measured by, for the aggregator.
 *
 * Keyed on the same normalized form `loadSkillReferences` matches on, so a
 * workbook writing "PartD_Phones" or "Part D Phones" resolves either way.
 */
export async function loadSkillMetrics(): Promise<Map<string, "cph" | "aht" | "case_rate">> {
  const rows = await db
    .select({ name: skillReferences.name, code: skillReferences.code, metric: skillReferences.metric })
    .from(skillReferences)
    .where(eq(skillReferences.active, true));

  const map = new Map<string, "cph" | "aht" | "case_rate">();
  for (const row of rows) {
    map.set(normalize(row.name), row.metric);
    map.set(normalize(row.code), row.metric);
  }

  const aliases = await db
    .select({ alias: skillAliases.sourceLabel, referenceId: skillAliases.skillReferenceId })
    .from(skillAliases);
  const metricById = new Map(
    (await db.select({ id: skillReferences.id, metric: skillReferences.metric }).from(skillReferences))
      .map((r) => [r.id, r.metric]),
  );
  for (const a of aliases) {
    const metric = metricById.get(a.referenceId);
    if (metric) map.set(normalize(a.alias), metric);
  }

  return map;
}

/**
 * Overrides the source row's own CPH/AHT target for employees with an
 * active ramp assignment, keyed exactly the way the aggregator already
 * looks up a row's skill: `${eid}|${weekStart}|${normalizedSkillLabel}`,
 * using the same alias normalization as loadSkillReferences so it matches
 * regardless of which spelling the row's skill column uses.
 *
 * A skill's own steady target already flows through the per-row
 * `cphTarget`/`ahtTarget` override mechanism (see applySourceTarget and
 * computeParMetrics's own use of `skill.cphTarget ?? reference.target`) —
 * this only replaces what the row itself would have supplied, for exactly
 * the weeks an active ramp window covers. An employee with no ramp
 * assignment, or whose ramp has completed, is entirely unaffected: nothing
 * is added to the map for them.
 */
export interface RampTargetOverride {
  cphTarget?: number;
  ahtTarget?: number;
}

/** `${eid}|${weekStart}|${normalizedSkillLabel}` -> the ramp-adjusted target for that row. */
export type RampTargets = Map<string, RampTargetOverride>;

export async function loadRampTargets(): Promise<RampTargets> {
  const assignments = await db
    .select({
      eid: employees.eid,
      rampStartWeek: employeeRampAssignments.rampStartWeek,
      skillReferenceId: employeeRampAssignments.skillReferenceId,
    })
    .from(employeeRampAssignments)
    .innerJoin(employees, eq(employees.id, employeeRampAssignments.employeeId));

  if (assignments.length === 0) return new Map();

  const schedules = await db.select().from(skillRampSchedules);
  const targetByStage = new Map<string, number>();
  for (const row of schedules) {
    targetByStage.set(`${row.skillReferenceId}|${row.stage}`, row.target);
  }

  const references = await db.select().from(skillReferences);
  const aliases = await db.select().from(skillAliases);
  const labelsById = new Map<string, string[]>();
  for (const ref of references) {
    labelsById.set(ref.id, [normalize(ref.code), normalize(ref.name)]);
  }
  for (const alias of aliases) {
    const labels = labelsById.get(alias.skillReferenceId);
    if (labels) labels.push(normalize(alias.sourceLabel));
  }
  const lowerIsBetterById = new Map(references.map((r) => [r.id, r.lowerIsBetter]));

  const map = new Map<string, RampTargetOverride>();
  for (const assignment of assignments) {
    const labels = labelsById.get(assignment.skillReferenceId);
    const lowerIsBetter = lowerIsBetterById.get(assignment.skillReferenceId);
    if (!labels || lowerIsBetter === undefined) continue;

    for (let stage = 0; stage <= LAST_STAGE; stage++) {
      const target = targetByStage.get(`${assignment.skillReferenceId}|${stage}`);
      if (target === undefined) continue;

      const weekStart = weekForStage(assignment.rampStartWeek, stage);
      const override: RampTargetOverride = lowerIsBetter
        ? { ahtTarget: target }
        : { cphTarget: target };
      for (const label of labels) {
        map.set(`${assignment.eid}|${weekStart}|${label}`, override);
      }
    }
  }

  return map;
}

/**
 * The employee's current ramp stage for `week`, or null if they have no
 * active ramp assignment covering it. For display — the import pipeline
 * itself only needs loadRampTargets.
 */
export async function currentRampStage(
  eid: string,
  week: string,
): Promise<{ stage: number; skillName: string } | null> {
  const [row] = await db
    .select({
      rampStartWeek: employeeRampAssignments.rampStartWeek,
      skillName: skillReferences.name,
    })
    .from(employeeRampAssignments)
    .innerJoin(employees, eq(employees.id, employeeRampAssignments.employeeId))
    .innerJoin(skillReferences, eq(skillReferences.id, employeeRampAssignments.skillReferenceId))
    .where(eq(employees.eid, eid))
    .limit(1);
  if (!row) return null;

  const stage = rampStageForWeek(row.rampStartWeek, week);
  return stage === null ? null : { stage, skillName: row.skillName };
}

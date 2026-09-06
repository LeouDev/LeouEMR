import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { skillReferences } from "@/lib/db/schema";
import {
  computeSkillRating,
  computeSkillRatio,
  type RatingThresholds,
} from "@/lib/kpi-engine/par-mbo";
import { computeQualityTotals, normalizeSkill } from "@/lib/kpi-engine/quality-metrics";
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
  lowerIsBetter: boolean;
  attributesPerAudit: number;
  thresholds: RatingThresholds;
}

/**
 * Matches a source skill label to a configured skill reference.
 * The workbook writes skills as free text ("Fax", "PartD_Phones"), so this
 * compares on a normalized form rather than requiring an exact match.
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function loadSkillReferences(): Promise<Map<string, SkillReference>> {
  const rows = await db.select().from(skillReferences).where(eq(skillReferences.active, true));

  const byKey = new Map<string, SkillReference>();
  for (const row of rows) {
    const reference: SkillReference = {
      code: row.code,
      name: row.name,
      target: row.target,
      lowerIsBetter: row.lowerIsBetter,
      attributesPerAudit: row.attributesPerAudit,
      thresholds: { r1: row.r1, r2: row.r2, r3: row.r3, r4: row.r4, r5: row.r5 },
    };
    byKey.set(normalize(row.code), reference);
    byKey.set(normalize(row.name), reference);
  }
  return byKey;
}

/** Normalized skill key -> attributes per audit, for the DPO denominator. */
export async function loadAttributesBySkill(): Promise<Map<string, number>> {
  const rows = await db.select().from(skillReferences).where(eq(skillReferences.active, true));
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(normalizeSkill(row.code), row.attributesPerAudit);
    map.set(normalizeSkill(row.name), row.attributesPerAudit);
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

        const target = skill.target ?? reference.target;
        if (!target) return null;

        const actual = reference.lowerIsBetter
          ? (skill.hours / skill.cases) * 3600 // seconds per case
          : skill.cases / skill.hours; // cases per hour

        const ratio = computeSkillRatio(actual, target, reference.lowerIsBetter);
        return {
          rating: computeSkillRating(ratio, reference.thresholds),
          hours: skill.hours,
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

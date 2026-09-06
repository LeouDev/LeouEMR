import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { skillReferences } from "@/lib/db/schema";
import {
  computeSkillRating,
  computeSkillRatio,
  type RatingThresholds,
} from "@/lib/kpi-engine/par-mbo";
import type { AggregatedMetric, QualityWeek, SkillWeek } from "./types";

export const PAR_KPI_CODES = {
  PRODUCTION_RATE: "PRODUCTION_RATE",
  DPU: "DPU",
} as const;

interface SkillReference {
  code: string;
  name: string;
  target: number;
  lowerIsBetter: boolean;
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
      thresholds: { r1: row.r1, r2: row.r2, r3: row.r3, r4: row.r4, r5: row.r5 },
    };
    byKey.set(normalize(row.code), reference);
    byKey.set(normalize(row.name), reference);
  }
  return byKey;
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
  }

  for (const week of qualityWeeks) {
    if (week.audits <= 0) continue;
    metrics.push({
      eid: week.eid,
      kpiCode: PAR_KPI_CODES.DPU as never,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      // Share of audits with no markdown, expressed as a percentage.
      actualValue: ((week.audits - week.imperfect) / week.audits) * 100,
      sampleSize: week.audits,
    });
  }

  return { metrics, unmatchedSkills: [...unmatched] };
}

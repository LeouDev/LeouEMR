/**
 * DPU and DPO for MBO scoring.
 *
 * Both are computed across ALL of an employee's audit records for the
 * period, regardless of skill — but they use skill differently:
 *
 *   DPU = (Total Audits − Total #<100) / Total Audits
 *         A straight sum. Skill and attributes play no part.
 *
 *   DPO = (Total Attributes − Total Markdown) / Total Attributes
 *         where each record contributes (its own skill's attributes
 *         × that record's audits). An employee audited on several skills
 *         must not be scored against one flat attributes value.
 */

/** The attributes-per-audit fallback for skills without a configured value. */
export const DEFAULT_ATTRIBUTES_PER_AUDIT = 23;

export interface QualityRecord {
  /** Skill label; resolved against the attributes lookup. */
  skill: string;
  audits: number;
  markdowns: number;
  /** Audits scoring below a perfect result. */
  imperfect: number;
}

export interface QualityTotals {
  audits: number;
  imperfect: number;
  markdowns: number;
  attributes: number;
  /** Null when there were no audits — never silently zero. */
  dpu: number | null;
  /** Null when no attributes could be attributed. */
  dpo: number | null;
}

/**
 * @param attributesBySkill normalized skill key -> attributes per audit
 */
export function computeQualityTotals(
  records: QualityRecord[],
  attributesBySkill: Map<string, number>,
): QualityTotals {
  let audits = 0;
  let imperfect = 0;
  let markdowns = 0;
  let attributes = 0;

  for (const record of records) {
    const perAudit =
      attributesBySkill.get(normalizeSkill(record.skill)) ?? DEFAULT_ATTRIBUTES_PER_AUDIT;

    audits += record.audits;
    imperfect += record.imperfect;
    markdowns += record.markdowns;
    attributes += perAudit * record.audits;
  }

  return {
    audits,
    imperfect,
    markdowns,
    attributes,
    dpu: audits > 0 ? ((audits - imperfect) / audits) * 100 : null,
    dpo: attributes > 0 ? ((attributes - markdowns) / attributes) * 100 : null,
  };
}

/** Skill labels arrive as free text, so matching is done on a normalized form. */
export function normalizeSkill(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Row-level attributes for display in the calculator: skill attributes × audits. */
export function rowAttributes(
  record: Pick<QualityRecord, "skill" | "audits">,
  attributesBySkill: Map<string, number>,
): number {
  const perAudit =
    attributesBySkill.get(normalizeSkill(record.skill)) ?? DEFAULT_ATTRIBUTES_PER_AUDIT;
  return perAudit * record.audits;
}

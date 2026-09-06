import { describe, expect, it } from "vitest";
import {
  computeQualityTotals,
  normalizeSkill,
  rowAttributes,
  DEFAULT_ATTRIBUTES_PER_AUDIT,
} from "./quality-metrics";

/** The business-supplied attributes-per-audit table. */
const ATTRIBUTES = new Map<string, number>([
  ["fax", 25],
  ["partdphones", 28],
  ["genphones", 28],
  ["uhcwest", 28],
  ["glp1", 25],
  ["outreach", 14],
  ["edits", 8],
  ["ocn", 34],
]);

describe("worked example supplied by the business", () => {
  // EDITS: Audits=5, Markdown=2, <100=1 -> Row Attributes = 8 x 5 = 40
  // Fax:   Audits=3, Markdown=1, <100=1 -> Row Attributes = 25 x 3 = 75
  // Totals: Audits=8, Markdown=3, <100=2, Attributes=115
  const records = [
    { skill: "EDITS", audits: 5, markdowns: 2, imperfect: 1 },
    { skill: "Fax", audits: 3, markdowns: 1, imperfect: 1 },
  ];

  it("produces the expected totals", () => {
    const totals = computeQualityTotals(records, ATTRIBUTES);
    expect(totals.audits).toBe(8);
    expect(totals.markdowns).toBe(3);
    expect(totals.imperfect).toBe(2);
    expect(totals.attributes).toBe(115);
  });

  it("produces DPU of exactly 75.00%", () => {
    const totals = computeQualityTotals(records, ATTRIBUTES);
    expect(totals.dpu).toBeCloseTo(75.0, 6);
  });

  it("produces DPO of exactly 97.39%", () => {
    const totals = computeQualityTotals(records, ATTRIBUTES);
    // (115 - 3) / 115 = 0.973913...
    expect(totals.dpo).toBeCloseTo(97.3913043478, 8);
    expect(totals.dpo!.toFixed(2)).toBe("97.39");
  });
});

describe("per-skill attributes", () => {
  it("weights each record by its own skill, not one flat value", () => {
    const mixed = computeQualityTotals(
      [
        { skill: "OCN", audits: 2, markdowns: 0, imperfect: 0 }, // 34 x 2 = 68
        { skill: "EDITS", audits: 2, markdowns: 0, imperfect: 0 }, // 8 x 2 = 16
      ],
      ATTRIBUTES,
    );
    expect(mixed.attributes).toBe(84);

    // Applying one skill's value to both would give 136 or 32, not 84.
    expect(mixed.attributes).not.toBe(34 * 4);
    expect(mixed.attributes).not.toBe(8 * 4);
  });

  it("falls back to 23 for skills with no configured value", () => {
    const totals = computeQualityTotals(
      [{ skill: "Misroutes", audits: 3, markdowns: 0, imperfect: 0 }],
      ATTRIBUTES,
    );
    expect(totals.attributes).toBe(DEFAULT_ATTRIBUTES_PER_AUDIT * 3);
  });

  it("matches skill labels regardless of case and punctuation", () => {
    expect(normalizeSkill("PartD_Phones")).toBe(normalizeSkill("partd phones"));
    expect(normalizeSkill("UHC_west")).toBe("uhcwest");

    const totals = computeQualityTotals(
      [{ skill: "partd_phones", audits: 1, markdowns: 0, imperfect: 0 }],
      ATTRIBUTES,
    );
    expect(totals.attributes).toBe(28);
  });
});

describe("DPU is independent of skill and attributes", () => {
  it("gives the same DPU however the audits are split across skills", () => {
    const together = computeQualityTotals(
      [{ skill: "EDITS", audits: 8, markdowns: 0, imperfect: 2 }],
      ATTRIBUTES,
    );
    const split = computeQualityTotals(
      [
        { skill: "EDITS", audits: 5, markdowns: 0, imperfect: 1 },
        { skill: "OCN", audits: 3, markdowns: 0, imperfect: 1 },
      ],
      ATTRIBUTES,
    );
    expect(together.dpu).toBeCloseTo(split.dpu!, 10);
    // ...while DPO does differ, because the attribute mix changed.
    expect(together.attributes).not.toBe(split.attributes);
  });
});

describe("edge cases", () => {
  it("returns null rather than zero when there are no audits", () => {
    const totals = computeQualityTotals([], ATTRIBUTES);
    expect(totals.dpu).toBeNull();
    expect(totals.dpo).toBeNull();
  });

  it("scores a flawless week as 100% on both", () => {
    const totals = computeQualityTotals(
      [{ skill: "Fax", audits: 4, markdowns: 0, imperfect: 0 }],
      ATTRIBUTES,
    );
    expect(totals.dpu).toBe(100);
    expect(totals.dpo).toBe(100);
  });

  it("computes row attributes for display", () => {
    expect(rowAttributes({ skill: "EDITS", audits: 5 }, ATTRIBUTES)).toBe(40);
    expect(rowAttributes({ skill: "Fax", audits: 3 }, ATTRIBUTES)).toBe(75);
  });
});

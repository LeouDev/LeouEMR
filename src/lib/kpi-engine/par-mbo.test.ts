import { describe, expect, it } from "vitest";
import {
  computeEmployeeFinalRate,
  computeQualityMetrics,
  computeSkillRating,
} from "./par-mbo";
import type { RatingThresholds } from "./par-mbo";

// Representative of MBO2's DEFAULT_REFERENCE shape: r3 = on-target = 1.00 ratio.
const thresholds: RatingThresholds = { r1: 0, r2: 0.7, r3: 1.0, r4: 1.15, r5: 1.3 };

describe("computeSkillRating", () => {
  it("scores exactly on-target performance as a clean 3.00", () => {
    expect(computeSkillRating(1.0, thresholds)).toBe(3);
  });

  it("clamps below the lowest threshold to the lowest rating", () => {
    expect(computeSkillRating(-1, thresholds)).toBe(1);
  });

  it("clamps above the highest threshold to the highest rating", () => {
    expect(computeSkillRating(5, thresholds)).toBe(5);
  });

  it("steps flat (no interpolation) within a below-target band", () => {
    // Anywhere in [r2, r3) should read as a flat 2, not a fraction.
    expect(computeSkillRating(0.75, thresholds)).toBe(2);
    expect(computeSkillRating(0.95, thresholds)).toBe(2);
  });

  it("interpolates linearly within an above-target band", () => {
    // Halfway between r3 (1.00 -> rating 3) and r4 (1.15 -> rating 4).
    const midpointRatio = (thresholds.r3 + thresholds.r4) / 2;
    expect(computeSkillRating(midpointRatio, thresholds)).toBeCloseTo(3.5, 5);
  });
});

describe("computeEmployeeFinalRate", () => {
  it("weights each skill's rating by its share of total production hours", () => {
    const result = computeEmployeeFinalRate([
      { skillCode: "A", actual: 100, target: 100, thresholds, hoursWorked: 30 }, // ratio 1.0 -> rating 3
      { skillCode: "B", actual: 130, target: 100, thresholds, hoursWorked: 10 }, // ratio 1.3 -> rating 5
    ]);
    // weights: A=0.75, B=0.25 -> 3*0.75 + 5*0.25 = 3.5
    expect(result.totalHours).toBe(40);
    expect(result.finalRate).toBeCloseTo(3.5, 5);
  });

  it("computes a lower-is-better ratio as target/actual", () => {
    const result = computeEmployeeFinalRate([
      {
        skillCode: "AHT",
        actual: 80, // faster than target -> ratio > 1 -> higher rating
        target: 100,
        thresholds,
        hoursWorked: 10,
        lowerIsBetter: true,
      },
    ]);
    expect(result.skills[0].ratio).toBeCloseTo(1.25, 5);
  });

  it("returns a zero rate for an employee with no skill rows", () => {
    const result = computeEmployeeFinalRate([]);
    expect(result.finalRate).toBe(0);
    expect(result.totalHours).toBe(0);
  });
});

describe("computeQualityMetrics", () => {
  it("computes DPU and DPO from audit tallies", () => {
    const metrics = computeQualityMetrics({
      audits: 20,
      under100: 2,
      markdown: 3,
      totalAttributes: 460,
    });
    expect(metrics.dpu).toBeCloseTo(0.9, 5);
    expect(metrics.dpo).toBeCloseTo((460 - 3) / 460, 5);
  });

  it("returns null rather than dividing by zero when there is no data", () => {
    const metrics = computeQualityMetrics({
      audits: 0,
      under100: 0,
      markdown: 0,
      totalAttributes: 0,
    });
    expect(metrics.dpu).toBeNull();
    expect(metrics.dpo).toBeNull();
  });
});

describe("final production rate, worked example", () => {
  // Reproduces the reference calculator exactly: three skills, weighted by
  // productive hours. Thresholds are the live values for these skills, so a
  // change to either the curve or the weighting shows up here first.
  const FAX = { r1: 0, r2: 0.8955, r3: 1.0, r4: 1.1682, r5: 1.2727 };
  const PARTD = { r1: 0, r2: 0.85, r3: 1.0, r4: 1.0892, r5: 1.1788 };
  const GLP1 = { r1: 0, r2: 0.895, r3: 1.0, r4: 1.168, r5: 1.2733 };

  const result = computeEmployeeFinalRate([
    { skillCode: "fax", actual: 12, target: 11, hoursWorked: 56, thresholds: FAX },
    {
      skillCode: "partd_phones",
      actual: 485,
      target: 500,
      hoursWorked: 32,
      // Average handle time: a lower actual is the better result.
      lowerIsBetter: true,
      thresholds: PARTD,
    },
    { skillCode: "glp_1", actual: 17, target: 15, hoursWorked: 23, thresholds: GLP1 },
  ]);

  it("totals the productive hours", () => {
    expect(result.totalHours).toBe(111);
  });

  it("computes each skill's ratio", () => {
    expect(result.skills[0].ratio).toBeCloseTo(1.0909, 4);
    // Inverted for the lower-is-better skill: 500 / 485, not 485 / 500.
    expect(result.skills[1].ratio).toBeCloseTo(1.0309, 4);
    expect(result.skills[2].ratio).toBeCloseTo(1.1333, 4);
  });

  it("interpolates each rating between R3 and R4", () => {
    expect(result.skills[0].rating).toBeCloseTo(3.54, 3);
    expect(result.skills[1].rating).toBeCloseTo(3.347, 3);
    expect(result.skills[2].rating).toBeCloseTo(3.794, 3);
  });

  it("weights each skill by its share of productive hours", () => {
    expect(result.skills[0].weight).toBeCloseTo(0.505, 3);
    expect(result.skills[1].weight).toBeCloseTo(0.288, 3);
    expect(result.skills[2].weight).toBeCloseTo(0.207, 3);
  });

  it("sums the weighted ratings into the final production rate", () => {
    const weighted = result.skills.map((s) => s.rating * s.weight);
    expect(weighted[0]).toBeCloseTo(1.786, 3);
    expect(weighted[1]).toBeCloseTo(0.965, 3);
    expect(weighted[2]).toBeCloseTo(0.786, 3);
    expect(result.finalRate).toBeCloseTo(3.537, 3);
  });
});

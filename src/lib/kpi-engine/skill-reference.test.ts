import { describe, expect, it } from "vitest";
import { computeSkillRating, computeSkillRatio } from "./par-mbo";
import type { RatingThresholds } from "./par-mbo";

/**
 * Verifies the rating curve against the real business skill reference data.
 *
 * The rule is deliberately asymmetric — flat steps below target, linear
 * interpolation above it — so these tests pin the exact boundary behavior:
 *
 *   ratio <= R1          -> 1.0
 *   R1 <  ratio <  R2    -> 1.0  (flat, no interpolation)
 *   R2 <= ratio <  R3    -> 2.0  (flat, no interpolation)
 *   R3 <= ratio <= R4    -> 3 + (ratio - R3) / (R4 - R3)
 *   R4 <  ratio <= R5    -> 4 + (ratio - R4) / (R5 - R4)
 *   ratio >  R5          -> 5.0  (capped)
 */

const FAX: RatingThresholds = { r5: 1.2727, r4: 1.1682, r3: 1.0, r2: 0.8955, r1: 0 };
const PARTD: RatingThresholds = { r5: 1.1788, r4: 1.0892, r3: 1.0, r2: 0.85, r1: 0 };
const AM_CANCELLATION_WB: RatingThresholds = { r5: 2.6, r4: 1.999, r3: 1.0, r2: 0.8, r1: 0 };

describe("rating curve — flat below target", () => {
  it("rates anywhere between R1 and R2 as a flat 1.0", () => {
    expect(computeSkillRating(0.1, FAX)).toBe(1);
    expect(computeSkillRating(0.5, FAX)).toBe(1);
    expect(computeSkillRating(0.8954, FAX)).toBe(1);
  });

  it("rates anywhere between R2 and R3 as a flat 2.0", () => {
    expect(computeSkillRating(0.8955, FAX)).toBe(2); // exactly R2
    expect(computeSkillRating(0.95, FAX)).toBe(2);
    expect(computeSkillRating(0.9999, FAX)).toBe(2);
  });

  it("rates at or below R1 as 1.0", () => {
    expect(computeSkillRating(0, FAX)).toBe(1);
    expect(computeSkillRating(-5, FAX)).toBe(1);
  });
});

describe("rating curve — interpolated at and above target", () => {
  it("rates exactly on target as a clean 3.000", () => {
    expect(computeSkillRating(1.0, FAX)).toBe(3);
    expect(computeSkillRating(1.0, PARTD)).toBe(3);
    expect(computeSkillRating(1.0, AM_CANCELLATION_WB)).toBe(3);
  });

  it("interpolates linearly between R3 and R4", () => {
    const midpoint = (FAX.r3 + FAX.r4) / 2;
    expect(computeSkillRating(midpoint, FAX)).toBeCloseTo(3.5, 6);
    // Exactly R4 is rating 4 from either adjacent band.
    expect(computeSkillRating(FAX.r4, FAX)).toBeCloseTo(4, 6);
  });

  it("interpolates linearly between R4 and R5", () => {
    const midpoint = (FAX.r4 + FAX.r5) / 2;
    expect(computeSkillRating(midpoint, FAX)).toBeCloseTo(4.5, 6);
  });

  it("caps at 5.0 at and beyond R5", () => {
    expect(computeSkillRating(FAX.r5, FAX)).toBe(5);
    expect(computeSkillRating(3.0, FAX)).toBe(5);
  });

  it("matches the spec formula across the interpolated bands", () => {
    const ratio = 1.1;
    const expected = 3 + (ratio - FAX.r3) / (FAX.r4 - FAX.r3);
    expect(computeSkillRating(ratio, FAX)).toBeCloseTo(expected, 10);

    const highRatio = 1.22;
    const expectedHigh = 4 + (highRatio - FAX.r4) / (FAX.r5 - FAX.r4);
    expect(computeSkillRating(highRatio, FAX)).toBeCloseTo(expectedHigh, 10);
  });
});

describe("computeSkillRatio", () => {
  it("uses actual/target for normal skills", () => {
    // Fax: target 11, actual 14 -> 127.27% -> at R5 -> rating 5
    expect(computeSkillRatio(14, 11, false)).toBeCloseTo(1.2727, 4);
    expect(computeSkillRating(computeSkillRatio(14, 11, false), FAX)).toBeCloseTo(5, 3);
  });

  it("inverts to target/actual for lower-is-better skills", () => {
    // PartD_Phones: target 500s. A faster 400s actual must rate higher, not lower.
    expect(computeSkillRatio(400, 500, true)).toBeCloseTo(1.25, 6);
    expect(computeSkillRating(computeSkillRatio(400, 500, true), PARTD)).toBe(5);

    // A slower 600s actual rates below target.
    expect(computeSkillRatio(600, 500, true)).toBeCloseTo(0.8333, 4);
    expect(computeSkillRating(computeSkillRatio(600, 500, true), PARTD)).toBe(1);

    // Exactly on target is 3.000 either way.
    expect(computeSkillRating(computeSkillRatio(500, 500, true), PARTD)).toBe(3);
  });

  it("does not divide by zero", () => {
    expect(computeSkillRatio(0, 500, true)).toBe(0);
    expect(computeSkillRatio(10, 0, false)).toBe(0);
  });
});

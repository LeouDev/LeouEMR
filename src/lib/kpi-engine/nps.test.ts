import { describe, expect, it } from "vitest";
import { classifyResponse, computeNps, promotersNeeded, totalResponses } from "./nps";

describe("NPS response classification", () => {
  it("reads the workbook's 100 / 0 / -100 encoding", () => {
    expect(classifyResponse(100)).toBe("promoter");
    expect(classifyResponse(0)).toBe("passive");
    expect(classifyResponse(-100)).toBe("detractor");
  });

  it("classifies by sign, not by magnitude", () => {
    expect(classifyResponse(1)).toBe("promoter");
    expect(classifyResponse(-1)).toBe("detractor");
  });
});

describe("computeNps", () => {
  it("is promoters less detractors, as a share of all responses", () => {
    // 6 promoters, 2 passives, 2 detractors of 10 → 60% - 20% = 40
    expect(computeNps({ promoters: 6, passives: 2, detractors: 2 })).toBe(40);
  });

  it("counts passives in the denominator but not the score", () => {
    expect(computeNps({ promoters: 1, passives: 0, detractors: 0 })).toBe(100);
    expect(computeNps({ promoters: 1, passives: 1, detractors: 0 })).toBe(50);
  });

  it("goes negative when detractors outweigh promoters", () => {
    expect(computeNps({ promoters: 1, passives: 0, detractors: 3 })).toBe(-50);
  });

  it("is null with no responses, never zero", () => {
    // Zero would read as neutral feedback; the truth is no feedback.
    expect(computeNps({ promoters: 0, passives: 0, detractors: 0 })).toBeNull();
    expect(totalResponses({ promoters: 0, passives: 0, detractors: 0 })).toBe(0);
  });
});

describe("promotersNeeded", () => {
  const TARGET = 70;

  it("is zero when the target is already met", () => {
    expect(promotersNeeded({ promoters: 9, passives: 0, detractors: 0 }, TARGET)).toBe(0);
    expect(promotersNeeded({ promoters: 17, passives: 0, detractors: 3 }, TARGET)).toBe(0);
  });

  it("returns the promoters that would actually reach the target", () => {
    const mix = { promoters: 6, passives: 2, detractors: 2 };
    const needed = promotersNeeded(mix, TARGET)!;

    expect(needed).toBeGreaterThan(0);
    // The answer must genuinely clear the target once applied.
    const after = computeNps({ ...mix, promoters: mix.promoters + needed })!;
    expect(after).toBeGreaterThanOrEqual(TARGET);

    // ...and one fewer must not, so the figure is the true minimum.
    const oneShort = computeNps({ ...mix, promoters: mix.promoters + needed - 1 })!;
    expect(oneShort).toBeLessThan(TARGET);
  });

  it("rounds up, since a fraction of a survey cannot be collected", () => {
    const mix = { promoters: 5, passives: 3, detractors: 2 };
    const needed = promotersNeeded(mix, TARGET)!;
    expect(Number.isInteger(needed)).toBe(true);
    expect(computeNps({ ...mix, promoters: mix.promoters + needed })!).toBeGreaterThanOrEqual(TARGET);
  });

  it("handles having no responses yet", () => {
    const needed = promotersNeeded({ promoters: 0, passives: 0, detractors: 0 }, TARGET)!;
    expect(needed).toBe(0);
  });

  it("reports an unreachable target rather than a misleading number", () => {
    // A perfect score cannot be recovered once a detractor exists.
    expect(promotersNeeded({ promoters: 1, passives: 0, detractors: 1 }, 100)).toBeNull();
  });

  it("needs many more promoters to dig out of a detractor-heavy month", () => {
    const light = promotersNeeded({ promoters: 5, passives: 0, detractors: 1 }, TARGET)!;
    const heavy = promotersNeeded({ promoters: 5, passives: 0, detractors: 10 }, TARGET)!;
    expect(heavy).toBeGreaterThan(light);
  });
});

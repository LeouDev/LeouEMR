import { describe, expect, it } from "vitest";
import { computeVarianceStatus, scoreSegments } from "./engine";

/**
 * Ported exactly from the reference tool's `variance()` — these pin down the
 * three bands and the boundary between them, since an off-by-one here would
 * silently reclassify a warn as a bad or a good as a warn.
 */
describe("computeVarianceStatus", () => {
  it("is good when under baseline", () => {
    expect(computeVarianceStatus(20, 30)).toBe("good");
  });

  it("is good exactly at baseline — the source tool's diff<=0 boundary", () => {
    expect(computeVarianceStatus(30, 30)).toBe("good");
  });

  it("is warn just over baseline", () => {
    expect(computeVarianceStatus(31, 30)).toBe("warn");
  });

  it("is warn at exactly 15% over — the source tool's pct<=15 boundary", () => {
    expect(computeVarianceStatus(34.5, 30)).toBe("warn");
  });

  it("is bad just past 15% over", () => {
    expect(computeVarianceStatus(35, 30)).toBe("bad");
  });

  it("bands by percentage, not a flat number of seconds", () => {
    // 20 seconds over a 30-second segment is 66% over — bad.
    expect(computeVarianceStatus(50, 30)).toBe("bad");
    // The same 20 seconds over a 120-second segment is under 17% — still close.
    expect(computeVarianceStatus(140, 120)).toBe("bad");
    expect(computeVarianceStatus(138, 120)).toBe("warn");
  });

  it("treats a zero baseline as maximally over rather than dividing by zero", () => {
    expect(computeVarianceStatus(5, 0)).toBe("bad");
    expect(computeVarianceStatus(0, 0)).toBe("good");
  });
});

describe("scoreSegments", () => {
  it("scores each segment independently and totals both columns", () => {
    const result = scoreSegments([
      { code: "opening", label: "Opening", baselineSeconds: 30, actualSeconds: 25 },
      { code: "investigation", label: "Investigation", baselineSeconds: 120, actualSeconds: 150 },
    ]);
    expect(result.segments.map((s) => s.status)).toEqual(["good", "bad"]);
    expect(result.totalActualSeconds).toBe(175);
    expect(result.totalBaselineSeconds).toBe(150);
  });

  it("handles no segments without dividing by zero or throwing", () => {
    const result = scoreSegments([]);
    expect(result).toEqual({ segments: [], totalActualSeconds: 0, totalBaselineSeconds: 0 });
  });
});

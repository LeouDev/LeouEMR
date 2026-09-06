import { describe, expect, it } from "vitest";
import { computeEwsRisk, computeEwsScore } from "./engine";
import type { EwsAssessmentInput } from "./engine";

function input(over: Partial<EwsAssessmentInput> = {}): EwsAssessmentInput {
  return { indicators: {}, capActive: false, attrition: "none", ...over };
}

describe("computeEwsScore", () => {
  it("counts only flagged indicators", () => {
    expect(
      computeEwsScore(input({ indicators: { tardy: true, absent: false, jobhunt: true } })),
    ).toBe(2);
  });

  it("adds one point for an active corrective action plan", () => {
    expect(computeEwsScore(input({ indicators: { tardy: true }, capActive: true }))).toBe(2);
  });

  it("is zero for a clean assessment", () => {
    expect(computeEwsScore(input())).toBe(0);
  });
});

describe("computeEwsRisk — score bands", () => {
  it("scores zero as GREEN", () => {
    expect(computeEwsRisk(input()).riskLevel).toBe("GREEN");
  });

  it("scores one to three as YELLOW", () => {
    expect(computeEwsRisk(input({ indicators: { a: true } })).riskLevel).toBe("YELLOW");
    expect(
      computeEwsRisk(input({ indicators: { a: true, b: true, c: true } })).riskLevel,
    ).toBe("YELLOW");
  });

  it("scores four or more as RED", () => {
    expect(
      computeEwsRisk(input({ indicators: { a: true, b: true, c: true, d: true } })).riskLevel,
    ).toBe("RED");
  });

  it("counts the CAP point toward the band, not just the score", () => {
    // Three indicators is YELLOW, but the CAP point tips it to four -> RED.
    const result = computeEwsRisk(
      input({ indicators: { a: true, b: true, c: true }, capActive: true }),
    );
    expect(result.score).toBe(4);
    expect(result.riskLevel).toBe("RED");
  });
});

describe("computeEwsRisk — attrition overrides", () => {
  it("marks confirmed attrition BLACK regardless of a clean score", () => {
    const result = computeEwsRisk(input({ attrition: "black" }));
    expect(result.score).toBe(0);
    expect(result.riskLevel).toBe("BLACK");
  });

  it("forces RED for leave states even with no indicators flagged", () => {
    for (const attrition of ["absconding", "loa", "maternity"] as const) {
      expect(computeEwsRisk(input({ attrition })).riskLevel).toBe("RED");
    }
  });

  it("lets BLACK win over a high score rather than double-counting", () => {
    const result = computeEwsRisk(
      input({ indicators: { a: true, b: true, c: true, d: true, e: true }, attrition: "black" }),
    );
    expect(result.score).toBe(5);
    expect(result.riskLevel).toBe("BLACK");
  });
});

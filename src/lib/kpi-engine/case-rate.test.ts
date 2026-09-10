import { describe, expect, it } from "vitest";
import { blendCaseRate } from "./case-rate";

describe("blendCaseRate", () => {
  it("divides the summed weight by the summed cases and scores against the mix's expectation", () => {
    const blended = blendCaseRate([
      { cases: 100, prodWeight: 1200, targetPerCase: 10 },
      { cases: 20, prodWeight: 200, targetPerCase: 15 },
    ]);
    expect(blended).toEqual({
      rate: 1400 / 120,
      target: (100 * 10 + 20 * 15) / 120,
      status: "PASS",
      cases: 120,
    });
  });

  it("fails when the weight produced is short of what the cases worked expected", () => {
    const blended = blendCaseRate([{ cases: 50, prodWeight: 499, targetPerCase: 10 }]);
    expect(blended?.status).toBe("FAIL");
    expect(blended?.rate).toBeCloseTo(9.98);
    expect(blended?.target).toBe(10);
  });

  it("passes on exactly the expected weight", () => {
    expect(blendCaseRate([{ cases: 50, prodWeight: 500, targetPerCase: 10 }])?.status).toBe("PASS");
  });

  it("lets a large easy skill carry a small demanding one, because totals are summed first", () => {
    // Per skill: 300 cases at 9.5 against 8 (well over), 3 cases at 12 against 15 (under).
    const blended = blendCaseRate([
      { cases: 300, prodWeight: 2850, targetPerCase: 8 },
      { cases: 3, prodWeight: 36, targetPerCase: 15 },
    ]);
    expect(blended?.status).toBe("PASS");
  });

  it("is no measurement with no cases or no weight", () => {
    expect(blendCaseRate([])).toBeNull();
    expect(blendCaseRate([{ cases: 0, prodWeight: 0, targetPerCase: 10 }])).toBeNull();
    expect(blendCaseRate([{ cases: 12, prodWeight: 0, targetPerCase: 10 }])).toBeNull();
  });
});

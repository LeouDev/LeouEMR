import { describe, expect, it } from "vitest";
import { evaluateKpi, toPassFail } from "./evaluate";
import type { KpiDefinition } from "./types";

describe("evaluateKpi — higher_is_better", () => {
  // Matches spec section 17's Quality example: Target 90%, Warning 92%, Failure 90%.
  const quality: KpiDefinition = {
    code: "QUALITY",
    name: "Quality",
    type: "percentage",
    direction: "higher_is_better",
    target: 90,
    warningThreshold: 92,
    failureThreshold: 90,
  };

  it("fails below the failure threshold", () => {
    // Section 2's worked example: Quality 88% against a 90% target -> Failing.
    expect(evaluateKpi(88, quality).status).toBe("FAIL");
  });

  it("warns between the failure and warning thresholds", () => {
    expect(evaluateKpi(91, quality).status).toBe("WARNING");
  });

  it("passes at or above the warning threshold", () => {
    expect(evaluateKpi(95, quality).status).toBe("PASS");
  });

  it("treats the failure threshold itself as not-failing", () => {
    expect(evaluateKpi(90, quality).status).not.toBe("FAIL");
  });
});

describe("evaluateKpi — lower_is_better", () => {
  // Matches spec section 17's AHT example: Target 750, Failure: > 750.
  const aht: KpiDefinition = {
    code: "AHT",
    name: "Average Handle Time",
    type: "number",
    direction: "lower_is_better",
    target: 750,
    failureThreshold: 750,
  };

  it("passes at or under the failure threshold", () => {
    expect(evaluateKpi(720, aht).status).toBe("PASS");
    expect(evaluateKpi(750, aht).status).toBe("PASS");
  });

  it("fails above the failure threshold", () => {
    expect(evaluateKpi(780, aht).status).toBe("FAIL");
  });

  it("supports an optional warning band", () => {
    const ahtWithWarning: KpiDefinition = { ...aht, warningThreshold: 700 };
    expect(evaluateKpi(720, ahtWithWarning).status).toBe("WARNING");
    expect(evaluateKpi(690, ahtWithWarning).status).toBe("PASS");
  });
});

describe("evaluateKpi — range", () => {
  const range: KpiDefinition = {
    code: "OCC",
    name: "Occupancy",
    type: "percentage",
    direction: "range",
    rangeMin: 80,
    rangeMax: 95,
  };

  it("passes within the range", () => {
    expect(evaluateKpi(88, range).status).toBe("PASS");
  });

  it("fails outside the range on either side", () => {
    expect(evaluateKpi(70, range).status).toBe("FAIL");
    expect(evaluateKpi(99, range).status).toBe("FAIL");
  });
});

describe("evaluateKpi — boolean_match", () => {
  const compliance: KpiDefinition = {
    code: "CERT",
    name: "Certification Current",
    type: "boolean",
    direction: "boolean_match",
    expected: true,
  };

  it("passes when actual matches expected", () => {
    expect(evaluateKpi(true, compliance).status).toBe("PASS");
  });

  it("fails when actual does not match expected", () => {
    expect(evaluateKpi(false, compliance).status).toBe("FAIL");
  });
});

describe("toPassFail", () => {
  it("collapses WARNING into PASS and leaves FAIL/PASS untouched", () => {
    expect(toPassFail("PASS")).toBe("PASS");
    expect(toPassFail("WARNING")).toBe("PASS");
    expect(toPassFail("FAIL")).toBe("FAIL");
  });
});

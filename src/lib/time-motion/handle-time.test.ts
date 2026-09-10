import { describe, expect, it } from "vitest";
import { isHandleTimeKpi } from "./engine";

describe("isHandleTimeKpi", () => {
  it("is true for the AHT KPI and for a handle-time skill's own KPI", () => {
    expect(isHandleTimeKpi({ code: "AHT", direction: "lower_is_better", skillReferenceId: null })).toBe(true);
    expect(
      isHandleTimeKpi({ code: "SKILL_GEN_PHONES", direction: "lower_is_better", skillReferenceId: "ref-1" }),
    ).toBe(true);
  });

  it("is false for a cases-per-hour or case-rate skill, and for Critical Errors", () => {
    expect(isHandleTimeKpi({ code: "SKILL_OCN", direction: "higher_is_better", skillReferenceId: "ref-2" })).toBe(false);
    expect(isHandleTimeKpi({ code: "SKILL_FAX", direction: "higher_is_better", skillReferenceId: "ref-3" })).toBe(false);
    expect(isHandleTimeKpi({ code: "CRITICAL_ERRORS", direction: "lower_is_better", skillReferenceId: null })).toBe(false);
  });
});

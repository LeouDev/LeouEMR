import { describe, expect, it } from "vitest";
import { ATTENTION_EXCLUDED_KPIS } from "./performance";

/**
 * The set is narrower than `generates_action_items` on purpose, and was
 * narrowed once already after that flag took four more KPIs out of the
 * table than intended. These pin the distinction so it is not "simplified"
 * back to the flag.
 */
describe("ATTENTION_EXCLUDED_KPIS", () => {
  it("is the MBO composite and its three gates", () => {
    expect([...ATTENTION_EXCLUDED_KPIS].sort()).toEqual(["DPO", "DPU", "MBO", "PRODUCTION_RATE"]);
  });

  it("keeps the weekly measures a leader acts on, flag or no flag", () => {
    // generates_action_items is false for all four of these — AHT, CPH and
    // Case Rate because the item is opened per skill (0042), Standard
    // Errors because it feeds the scorecard (0050) — but a failure is still
    // this week's work, so Attention required must list them.
    for (const code of ["AHT", "CPH", "CASE_RATE", "STANDARD_ERRORS"]) {
      expect(ATTENTION_EXCLUDED_KPIS).not.toContain(code);
    }
  });

  it("never excludes a per-skill KPI", () => {
    expect(ATTENTION_EXCLUDED_KPIS.some((code) => code.startsWith("SKILL_"))).toBe(false);
  });
});

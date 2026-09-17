import { describe, expect, it } from "vitest";
import { whole } from "./manager-dashboard";

/**
 * The supervisor table's figures are whole numbers, and the reason they round
 * down rather than to nearest is a property, not a preference: a figure must
 * never disagree with the colour the row gives it.
 */
describe("whole", () => {
  it("drops the decimals rather than rounding them up", () => {
    expect(whole(97.6, "%")).toBe("97%");
    expect(whole(99.8, "%")).toBe("99%");
    expect(whole(100, "%")).toBe("100%");
  });

  it("never prints a figure at its target that is short of it", () => {
    // 97.6% is below a 98% target and the row reads red. Rounding to nearest
    // would print "98%" in red, which reads as a fault in the page.
    const target = 98;
    for (const actual of [97.5, 97.6, 97.9, 97.99]) {
      expect(actual < target).toBe(true);
      expect(Number(whole(actual))).toBeLessThan(target);
    }
    // And a figure that does clear the bar still reads at or above it.
    expect(Number(whole(98))).toBeGreaterThanOrEqual(target);
    expect(Number(whole(98.4))).toBeGreaterThanOrEqual(target);
  });

  it("reads a score with no suffix, and nothing measured as a dash", () => {
    expect(whole(72.9)).toBe("72");
    expect(whole(null, "%")).toBe("—");
    expect(whole(null)).toBe("—");
  });

  it("takes a negative NPS the conservative way", () => {
    expect(whole(-12.4)).toBe("-13");
  });
});

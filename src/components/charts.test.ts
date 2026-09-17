import { describe, expect, it } from "vitest";
import { labelStride } from "./charts";

/**
 * How value labels thin out. The point of the stride is that a label never
 * overprints its neighbour: on a short range every point is labelled, and on
 * a long one the labels step apart rather than collapsing into a smear.
 */
describe("labelStride", () => {
  it("labels every point when there is room for one", () => {
    // Twelve weeks across the trend chart's plot area: ~61 units apart, far
    // wider than a label.
    expect(labelStride(12, 672)).toBe(1);
    expect(labelStride(2, 672)).toBe(1);
  });

  it("steps apart as the points crowd, rather than letting labels collide", () => {
    // A year of weeks over the same width is ~13 units a point.
    expect(labelStride(52, 672)).toBe(3);
    expect(labelStride(104, 672)).toBe(6);
  });

  it("never returns a stride below one, which would divide by zero or label nothing", () => {
    for (const count of [0, 1, 2, 5, 400]) {
      expect(labelStride(count, 672)).toBeGreaterThanOrEqual(1);
    }
  });

  it("always labels the first point, whatever the stride", () => {
    // Index 0 is a multiple of every stride, so the leftmost figure is never
    // the one dropped.
    for (const count of [12, 52, 104]) {
      expect(0 % labelStride(count, 672)).toBe(0);
    }
  });

  it("widens the stride for a wider label", () => {
    expect(labelStride(52, 672, 60)).toBeGreaterThan(labelStride(52, 672, 20));
  });

  it("stays a real number for a plot with no width, rather than Infinity", () => {
    expect(labelStride(20, 10)).toBeGreaterThan(1);
    expect(labelStride(20, 0)).toBe(20);
    for (const width of [0, -10, Number.NaN]) {
      expect(Number.isFinite(labelStride(20, width))).toBe(true);
    }
  });

  it("never strides past the number of points it has", () => {
    expect(labelStride(4, 4)).toBeLessThanOrEqual(4);
  });
});

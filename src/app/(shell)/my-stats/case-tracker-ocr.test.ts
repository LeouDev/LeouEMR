import { describe, expect, it } from "vitest";
import { preprocessScale } from "./case-tracker-ocr";

/**
 * The caller runs a synchronous per-pixel loop over width*scale x
 * height*scale on the main thread — every case here asserts the OUTPUT
 * pixel count as much as the scale itself, since that's the number that
 * actually determines whether a paste freezes the tab.
 */
const outputPixels = (w: number, h: number, scale: number) =>
  Math.round(w * scale) * Math.round(h * scale);

describe("preprocessScale", () => {
  it("does not upscale an already-large screenshot at all", () => {
    // The bug: Math.max(2, ...) guaranteed at least 2x regardless of
    // input size, doubling an ordinary laptop screenshot to 8.3M pixels.
    expect(preprocessScale(1920, 1080)).toBe(1);
    expect(outputPixels(1920, 1080, preprocessScale(1920, 1080))).toBeLessThan(3_000_000);
  });

  it("caps a 4K screenshot well under the old 33-megapixel result", () => {
    const scale = preprocessScale(3840, 2160);
    expect(outputPixels(3840, 2160, scale)).toBeLessThan(4_000_000);
  });

  it("caps an extreme multi-monitor capture the same way", () => {
    const scale = preprocessScale(7680, 2160);
    expect(outputPixels(7680, 2160, scale)).toBeLessThan(4_000_000);
  });

  it("still upscales a small crop up to 2x for OCR quality", () => {
    expect(preprocessScale(800, 400)).toBe(2);
  });

  it("never upscales a small image past 2x even if the target implies more", () => {
    // 1600 / 300 = 5.33x — must still clamp to 2x, not chase the target.
    expect(preprocessScale(300, 150)).toBe(2);
  });

  it("respects the maxDimension cap even for a small enough width", () => {
    // A narrow but extremely tall image: width alone would upscale it,
    // but height must not be allowed to blow past the cap.
    const scale = preprocessScale(500, 5000);
    expect(Math.round(5000 * scale)).toBeLessThanOrEqual(2400);
  });

  it("never returns a scale that produces a zero-pixel dimension", () => {
    expect(preprocessScale(1, 1)).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { hasInk, parseSignature, signaturePath, signatureSchema, signedAt } from "./signature";

const INK = { w: 600, h: 200, strokes: [[10, 10, 50, 40, 90, 20]] };

describe("signatureSchema", () => {
  it("accepts a drawn signature", () => {
    expect(signatureSchema.safeParse(INK).success).toBe(true);
  });

  it("refuses an empty pad, a lone tap, and an odd point list", () => {
    expect(signatureSchema.safeParse({ ...INK, strokes: [] }).success).toBe(false);
    expect(signatureSchema.safeParse({ ...INK, strokes: [[10, 10]] }).success).toBe(false);
    expect(signatureSchema.safeParse({ ...INK, strokes: [[10, 10, 20]] }).success).toBe(false);
  });

  it("names the empty pad plainly", () => {
    const result = signatureSchema.safeParse({ ...INK, strokes: [[10, 10]] });
    expect(result.success ? null : result.error.issues[0]?.message).toBe("Draw your signature before confirming");
  });

  it("refuses points outside any pad and non-integers", () => {
    expect(signatureSchema.safeParse({ ...INK, strokes: [[10, 10, 5000, 40]] }).success).toBe(false);
    expect(signatureSchema.safeParse({ ...INK, strokes: [[10.5, 10, 50, 40]] }).success).toBe(false);
  });

  it("caps the detail so a stamp stays small", () => {
    const huge = Array.from({ length: 2 * 20_001 }, (_, i) => i % 600);
    expect(signatureSchema.safeParse({ ...INK, strokes: [huge, huge.slice(0, 4000)] }).success).toBe(false);
  });
});

describe("parseSignature", () => {
  it("reads a stored value back and rejects anything else", () => {
    expect(parseSignature(INK)).toEqual(INK);
    expect(parseSignature(null)).toBeNull();
    expect(parseSignature("scribble")).toBeNull();
  });
});

describe("signaturePath", () => {
  it("joins each stroke's points into a path", () => {
    expect(signaturePath({ strokes: [[10, 10, 50, 40, 90, 20], [100, 100, 120, 110]] })).toBe(
      "M10 10 L50 40 L90 20 M100 100 L120 110",
    );
  });

  it("draws a lone point as a dot", () => {
    expect(signaturePath({ strokes: [[10, 10, 50, 40], [70, 70]] })).toBe("M10 10 L50 40 M70 70 L70 70");
  });

  it("counts ink across strokes", () => {
    expect(hasInk({ strokes: [[1, 1], [2, 2]] })).toBe(true);
    expect(hasInk({ strokes: [[1, 1]] })).toBe(false);
  });
});

describe("signedAt", () => {
  it("prints the stamp in Manila time", () => {
    expect(signedAt(new Date("2026-09-14T06:42:00Z"))).toBe("Sep 14, 2026, 2:42 PM Manila time");
  });
});

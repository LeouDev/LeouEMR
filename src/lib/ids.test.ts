import { describe, expect, it } from "vitest";
import { isUuid } from "./ids";

describe("isUuid", () => {
  it("accepts a real uuid", () => {
    expect(isUuid("5b3d1c0e-8a44-4d2f-9c9a-2f6f0f5a1b2c")).toBe(true);
  });

  it("rejects what a hand-edited URL tends to carry", () => {
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("5b3d1c0e-8a44-4d2f-9c9a")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

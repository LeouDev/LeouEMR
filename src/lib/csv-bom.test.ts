import { describe, expect, it } from "vitest";
import { CSV_BOM } from "./csv-bom";

/**
 * The constant is one invisible character, so nothing about reading the file
 * tells you it is still there. It was briefly written as the character
 * itself, where a formatter that strips zero-width characters would have
 * emptied it and every export would have opened as mojibake with no test
 * failing. This is that test.
 */
describe("CSV_BOM", () => {
  it("is the byte-order mark, and exactly that", () => {
    expect(CSV_BOM).toHaveLength(1);
    expect(CSV_BOM.codePointAt(0)).toBe(0xfeff);
  });

  it("encodes to the three bytes Excel looks for", () => {
    expect([...Buffer.from(CSV_BOM, "utf8")]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

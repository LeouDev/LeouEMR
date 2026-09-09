import { describe, expect, it } from "vitest";
import { abridge } from "./rank-table";

const rows = Array.from({ length: 100 }, (_, i) => ({ rank: i + 1 }));

describe("abridge", () => {
  it("keeps a short ranking whole", () => {
    expect(abridge(rows.slice(0, 15), 20)).toHaveLength(15);
  });

  it("keeps the top block and the window around the viewer", () => {
    const shown = abridge(rows, 20, 57).map((r) => r.rank);
    expect(shown.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(shown.slice(20)).toEqual([54, 55, 56, 57, 58, 59, 60]);
  });

  it("does not duplicate rows when the viewer is already in the top block", () => {
    // Top 20 plus the window 16–22 around rank 19 is ranks 1–22, each once.
    const shown = abridge(rows, 20, 19).map((r) => r.rank);
    expect(shown).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
  });

  it("shows only the top block for a viewer with no rank", () => {
    expect(abridge(rows, 20)).toHaveLength(20);
  });
});

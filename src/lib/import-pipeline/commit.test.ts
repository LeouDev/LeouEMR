import { describe, expect, it } from "vitest";
import { factWindow } from "./commit";

describe("factWindow", () => {
  it("spans from the earliest week start to the latest week end", () => {
    const window = factWindow([
      { weekStart: "2026-08-08", weekEnd: "2026-08-14" },
      { weekStart: "2026-07-25", weekEnd: "2026-07-31" },
      { weekStart: "2026-08-01", weekEnd: "2026-08-07" },
    ]);
    expect(window).toEqual({ start: "2026-07-25", end: "2026-08-14" });
  });

  it("collapses to the one week when every row is in it", () => {
    const window = factWindow([
      { weekStart: "2026-08-08", weekEnd: "2026-08-14" },
      { weekStart: "2026-08-08", weekEnd: "2026-08-14" },
    ]);
    expect(window).toEqual({ start: "2026-08-08", end: "2026-08-14" });
  });
});

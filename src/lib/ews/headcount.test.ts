import { describe, expect, it } from "vitest";
import { emptyEntry, headcountChain, headcountStats, parseYear, sumChains } from "./headcount";

const entries = [
  { ...emptyEntry(1), openingOverride: 42, newHires: 4, transferOut: 1, voluntaryAttrition: 1 },
  { ...emptyEntry(2), newHires: 2, transferIn: 1, voluntaryAttrition: 2 },
  { ...emptyEntry(3), newHires: 3, voluntaryAttrition: 1, involuntaryAttrition: 1 },
];

describe("headcountChain", () => {
  it("opens each month on the one before, from the override where there is one", () => {
    const chain = headcountChain(entries);
    expect(chain).toHaveLength(12);
    expect(chain[0]).toMatchObject({ label: "Jan", opening: 42, attrition: 1, closing: 44, recorded: true });
    expect(chain[1]).toMatchObject({ label: "Feb", opening: 44, attrition: 2, closing: 45 });
    expect(chain[2]).toMatchObject({ label: "Mar", opening: 45, attrition: 2, closing: 46 });
    // Nothing recorded from April: zero movement, the figure carries.
    expect(chain[3]).toMatchObject({ label: "Apr", opening: 46, closing: 46, recorded: false });
    expect(chain[11]).toMatchObject({ label: "Dec", opening: 46, closing: 46 });
  });

  it("starts January from nothing without an override, and a later override restarts the chain", () => {
    const chain = headcountChain([{ ...emptyEntry(1), newHires: 5 }, { ...emptyEntry(6), openingOverride: 20, newHires: 1 }]);
    expect(chain[0]).toMatchObject({ opening: 0, closing: 5 });
    expect(chain[4]).toMatchObject({ opening: 5, closing: 5 });
    expect(chain[5]).toMatchObject({ opening: 20, closing: 21 });
    expect(chain[6]).toMatchObject({ opening: 21 });
  });
});

describe("sumChains", () => {
  it("adds the teams up month by month", () => {
    const a = headcountChain(entries);
    const b = headcountChain([{ ...emptyEntry(1), openingOverride: 10, newHires: 1 }]);
    const all = sumChains([a, b]);
    expect(all[0]).toMatchObject({ opening: 52, newHires: 5, closing: 55, openingOverride: null, recorded: true });
    expect(all[3]).toMatchObject({ opening: 57, closing: 57, recorded: false });
  });
});

describe("headcountStats", () => {
  it("reads the year off the chain: December's closing, the YTD sums and attrition over January's opening", () => {
    const stats = headcountStats(headcountChain(entries));
    expect(stats).toEqual({
      projectedEoy: 46,
      ytdNewHires: 9,
      ytdVoluntary: 4,
      ytdInvoluntary: 1,
      attritionPct: 11.9,
      through: "Jan through Mar",
    });
  });

  it("has no attrition rate for a team that opened the year on nothing, and no span when nothing is recorded", () => {
    const stats = headcountStats(headcountChain([]));
    expect(stats.attritionPct).toBeNull();
    expect(stats.through).toBeNull();
    expect(headcountStats(headcountChain([{ ...emptyEntry(1), newHires: 2 }])).through).toBe("January");
  });
});

describe("parseYear", () => {
  it("takes a sensible year and falls back to this one", () => {
    expect(parseYear("2025", "2026-09-22")).toBe(2025);
    expect(parseYear("2027", "2026-09-22")).toBe(2027);
    expect(parseYear("2031", "2026-09-22")).toBe(2026);
    expect(parseYear("abc", "2026-09-22")).toBe(2026);
    expect(parseYear(undefined, "2026-09-22")).toBe(2026);
  });
});

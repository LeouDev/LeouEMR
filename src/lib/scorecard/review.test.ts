import { describe, expect, it } from "vitest";
import { canReview, changedSinceReview, errorWindow, monthEndOf, monthStartOf, reviewOpensOn } from "./review";

describe("the review lock", () => {
  it("opens ten days after the month ends", () => {
    expect(reviewOpensOn("2026-09-01")).toBe("2026-10-10");
    expect(reviewOpensOn("2026-02-01")).toBe("2026-03-10");
    expect(reviewOpensOn("2026-12-01")).toBe("2027-01-10");
  });

  it("is closed until that day and open from it", () => {
    expect(canReview("2026-09-01", "2026-10-09")).toBe(false);
    expect(canReview("2026-09-01", "2026-10-10")).toBe(true);
    expect(canReview("2026-09-01", "2026-11-30")).toBe(true);
  });
});

describe("month arithmetic", () => {
  it("finds the month around a date", () => {
    expect(monthStartOf("2026-09-14")).toBe("2026-09-01");
    expect(monthEndOf("2026-09-01")).toBe("2026-09-30");
    expect(monthEndOf("2026-02-01")).toBe("2026-02-28");
  });

  it("spans the six months ending with the card's month", () => {
    expect(errorWindow("2026-09-01")).toEqual({ start: "2026-04-01", end: "2026-09-30" });
    expect(errorWindow("2026-10-01")).toEqual({ start: "2026-05-01", end: "2026-10-31" });
    expect(errorWindow("2026-01-01")).toEqual({ start: "2025-08-01", end: "2026-01-31" });
  });
});

describe("changedSinceReview", () => {
  it("flags a card whose score moved past rounding", () => {
    expect(changedSinceReview(4.12, 4.12)).toBe(false);
    expect(changedSinceReview(4.12, 4.124)).toBe(false);
    expect(changedSinceReview(4.12, 4.13)).toBe(true);
    expect(changedSinceReview(4.12, null)).toBe(true);
    expect(changedSinceReview(null, null)).toBe(false);
  });
});

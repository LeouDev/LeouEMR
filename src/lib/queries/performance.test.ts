import { describe, expect, it } from "vitest";
import { isDevelopmentItemStale } from "./performance";

/**
 * A row on the "Development item" table drops off once it has passed the
 * most recent SUSTAINED_PASS_WEEKS (8) weeks in a row, or has nothing
 * recorded against it at all in that same window — resolved, or gone
 * stale. These pin down the exact window and the cases that must stay
 * visible: too little history to judge, a fail breaking the streak, and a
 * mix of some weeks with data and some without (neither a clean pass nor
 * fully empty).
 */

type Point = { result: "pass" | "fail"; consecutiveCountAfter: number };
const pass = (n = 1): Point => ({ result: "pass", consecutiveCountAfter: n });
const fail: Point = { result: "fail", consecutiveCountAfter: 0 };

/** 12 ascending week starts, W01 oldest .. W12 latest. */
const WEEKS = Array.from({ length: 12 }, (_, i) => `2026-W${String(i + 1).padStart(2, "0")}`);

function historyFor(points: Array<Point | undefined>): Map<string, Point> {
  const history = new Map<string, Point>();
  points.forEach((point, i) => {
    if (point !== undefined) history.set(WEEKS[i], point);
  });
  return history;
}

describe("isDevelopmentItemStale", () => {
  it("hides a row that passed the most recent 8 weeks straight", () => {
    const history = historyFor([fail, fail, fail, fail, pass(1), pass(2), pass(3), pass(4), pass(5), pass(6), pass(7), pass(8)]);
    expect(isDevelopmentItemStale(WEEKS, history)).toBe(true);
  });

  it("hides a row with nothing recorded in the most recent 8 weeks", () => {
    // All its history is from the opening weeks, none of it recent —
    // never followed up since, or the KPI stopped being measured.
    const history = historyFor([fail, pass(1), pass(2), pass(3)]);
    expect(isDevelopmentItemStale(WEEKS, history)).toBe(true);
  });

  it("keeps a row visible when one of the last 8 weeks failed", () => {
    const history = historyFor([pass(1), pass(2), pass(3), pass(4), pass(5), pass(6), fail, pass(1)]);
    expect(isDevelopmentItemStale(WEEKS, history)).toBe(false);
  });

  it("keeps a row visible on a mix of some recent weeks with data and some without", () => {
    // Neither a clean 8-week pass nor fully empty — still worth a look.
    const history = historyFor([fail, pass(1), pass(2), undefined, undefined, pass(1), undefined, pass(2)]);
    expect(isDevelopmentItemStale(WEEKS, history)).toBe(false);
  });

  it("keeps a row visible with fewer than 8 weeks of plan history, even with nothing recorded", () => {
    const shortWeeks = WEEKS.slice(0, 5);
    expect(isDevelopmentItemStale(shortWeeks, new Map())).toBe(false);
  });

  it("keeps a freshly opened item visible — its own opening fail sits inside the window", () => {
    const history = historyFor([undefined, undefined, undefined, undefined, undefined, undefined, undefined, fail]);
    expect(isDevelopmentItemStale(WEEKS, history)).toBe(false);
  });

  it("looks only at the most recent 8 — an old clean streak that then went stale still hides", () => {
    // Passed weeks 1-4, then nothing recorded for the 8 weeks since —
    // the streak itself isn't what's being read, only the current window.
    const history = historyFor([pass(1), pass(2), pass(3), pass(4)]);
    expect(isDevelopmentItemStale(WEEKS, history)).toBe(true);
  });
});

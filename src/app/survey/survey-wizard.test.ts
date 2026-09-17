import { describe, expect, it } from "vitest";
import { canAdvance, STEPS } from "./survey-wizard";

const EMPTY = { q1Overall: null, q2Ease: null, q3Findability: null, q4Nps: null, q5Feedback: "" };

/**
 * What unlocks Next. Every step needs an answer before the person can move
 * on, and the one that is easy to get wrong is the NPS zero: 0 is a real
 * answer — the worst one — and a falsy check would refuse to accept it.
 */
describe("canAdvance", () => {
  it("holds each scale step until it has an answer", () => {
    expect(canAdvance(1, EMPTY)).toBe(false);
    expect(canAdvance(1, { ...EMPTY, q1Overall: 1 })).toBe(true);
    expect(canAdvance(2, { ...EMPTY, q1Overall: 5 })).toBe(false);
    expect(canAdvance(2, { ...EMPTY, q2Ease: 3 })).toBe(true);
    expect(canAdvance(3, { ...EMPTY, q3Findability: 4 })).toBe(true);
  });

  it("accepts a zero on the NPS step, which is an answer and not an absence", () => {
    expect(canAdvance(4, { ...EMPTY, q4Nps: 0 })).toBe(true);
    expect(canAdvance(4, { ...EMPTY, q4Nps: 10 })).toBe(true);
    expect(canAdvance(4, EMPTY)).toBe(false);
  });

  it("wants real text on the last step, not whitespace", () => {
    expect(canAdvance(STEPS, { ...EMPTY, q5Feedback: "" })).toBe(false);
    expect(canAdvance(STEPS, { ...EMPTY, q5Feedback: "   \n\t " })).toBe(false);
    expect(canAdvance(STEPS, { ...EMPTY, q5Feedback: "Dark mode" })).toBe(true);
  });

  it("is five steps, matching the five questions the copy promises", () => {
    expect(STEPS).toBe(5);
  });
});

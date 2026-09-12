import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "./password";

describe("passwordProblem", () => {
  it("wants at least the minimum length, a letter and a digit", () => {
    expect(passwordProblem("short1")).toMatch(new RegExp(String(MIN_PASSWORD_LENGTH)));
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toMatch(/digit/);
    expect(passwordProblem("1".repeat(MIN_PASSWORD_LENGTH))).toMatch(/letter/);
    expect(passwordProblem("correct horse battery 9")).toBeNull();
  });

  it("checks the confirmation only when one is given", () => {
    const good = "correct horse battery 9";
    expect(passwordProblem(good, good)).toBeNull();
    expect(passwordProblem(good, "correct horse battery 8")).toMatch(/do not match/);
    expect(passwordProblem(good)).toBeNull();
  });

  it("reports length before a mismatch", () => {
    expect(passwordProblem("short", "different")).toMatch(/characters/);
  });
});

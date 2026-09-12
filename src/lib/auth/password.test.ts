import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "./password";

describe("passwordProblem", () => {
  it("wants at least the minimum length", () => {
    expect(passwordProblem("short")).toMatch(new RegExp(String(MIN_PASSWORD_LENGTH)));
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("checks the confirmation only when one is given", () => {
    const good = "correct horse battery";
    expect(passwordProblem(good, good)).toBeNull();
    expect(passwordProblem(good, "correct horse batter")).toMatch(/do not match/);
    expect(passwordProblem(good)).toBeNull();
  });

  it("reports length before a mismatch", () => {
    expect(passwordProblem("short", "different")).toMatch(/characters/);
  });
});

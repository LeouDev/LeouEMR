import { describe, expect, it } from "vitest";
import { PLACEHOLDER_FACES, placeholderFace } from "./faces";

describe("placeholderFace", () => {
  it("always gives the same person the same drawing", () => {
    // It is picked on every render, on the server and again in the browser:
    // an unstable pick would swap the face at hydration.
    expect(placeholderFace("emp-1")).toBe(placeholderFace("emp-1"));
    expect(placeholderFace("Archiene Ross Calderon Herbias")).toBe(
      placeholderFace("Archiene Ross Calderon Herbias"),
    );
  });

  it("only ever returns one of the drawings that exist", () => {
    for (const key of ["", "a", "emp-1", "emp-2", "Maria", "x".repeat(200)]) {
      expect(PLACEHOLDER_FACES).toContain(placeholderFace(key));
    }
  });

  it("spreads a roster across both of them", () => {
    // Not a fifty-fifty assertion — a hash is not a shuffle — but a whole
    // roster landing on one drawing would mean the pick was not working.
    const keys = Array.from({ length: 400 }, (_, i) => `employee-${i}`);
    const counts = new Map<string, number>();
    for (const key of keys) {
      const face = placeholderFace(key);
      counts.set(face, (counts.get(face) ?? 0) + 1);
    }

    expect(counts.size).toBe(PLACEHOLDER_FACES.length);
    for (const n of counts.values()) expect(n).toBeGreaterThan(keys.length / 4);
  });

  it("does not read anything into the name it is given", () => {
    // The pick is arbitrary by design: there is no gender on an employee or
    // a user in this app, and guessing one from a name to choose a face is
    // the thing this helper exists to avoid. This is a reminder of that, not
    // a claim about these two names in particular.
    const byName = ["Maria", "Jose"].map(placeholderFace);
    expect(PLACEHOLDER_FACES).toContain(byName[0]);
    expect(PLACEHOLDER_FACES).toContain(byName[1]);
  });
});

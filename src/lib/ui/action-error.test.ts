import { describe, expect, it } from "vitest";
import { describeActionError } from "./action-error";

describe("describeActionError", () => {
  it("names the connection when fetch itself failed", () => {
    expect(describeActionError(new TypeError("Failed to fetch"))).toMatch(/connection/);
    expect(describeActionError(new TypeError("NetworkError when attempting to fetch resource."))).toMatch(
      /connection/,
    );
    expect(describeActionError(new TypeError("Load failed"))).toMatch(/connection/);
  });

  it("never echoes an opaque server error at the user", () => {
    const text = describeActionError(
      new Error("An error occurred in the Server Components render. Digest: 1234567890"),
    );
    expect(text).not.toMatch(/digest|1234567890/i);
    expect(text).toMatch(/try again/);
  });

  it("lets an action that is not a save say what its own throw means", () => {
    const fallback = "The send did not finish.";
    expect(describeActionError(new Error("Digest: 987"), fallback)).toBe(fallback);
    // The connection wording still wins: it is more specific than any fallback.
    expect(describeActionError(new TypeError("Failed to fetch"), fallback)).toMatch(/connection/);
  });

  it("copes with a non-Error throw", () => {
    expect(describeActionError(undefined)).toMatch(/try again/);
    expect(describeActionError("boom")).toMatch(/try again/);
  });
});

import { describe, expect, it } from "vitest";
import { config } from "./middleware";

/**
 * The pages and actions trust the identity headers the middleware sets,
 * because the middleware overwrites whatever a client sent. That holds only
 * while the middleware runs on every request: a matcher condition that
 * skipped it for some requests (it once skipped prefetches, by header) let
 * anyone who sent that header forge `x-user-id` and act as any account.
 */
describe("middleware matcher", () => {
  it("runs on every request — no header conditions that a client could satisfy to skip it", () => {
    expect(config.matcher.length).toBeGreaterThan(0);
    for (const entry of config.matcher) {
      if (typeof entry === "string") continue;
      expect(entry).not.toHaveProperty("missing");
      expect(entry).not.toHaveProperty("has");
    }
  });
});

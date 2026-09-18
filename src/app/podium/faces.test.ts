import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDER_FACE } from "./faces";

describe("the podium's stand-in face", () => {
  it("names a file that is actually in public/", () => {
    // The only way this can break is silently: rename or move the asset and
    // the podium serves a 404 into the helmet ring, which no other test
    // would notice because nothing here imports the image.
    expect(existsSync(join(process.cwd(), "public", PLACEHOLDER_FACE))).toBe(true);
  });

  it("is served from the app's own origin, not fetched from somewhere else", () => {
    expect(PLACEHOLDER_FACE.startsWith("/")).toBe(true);
  });
});

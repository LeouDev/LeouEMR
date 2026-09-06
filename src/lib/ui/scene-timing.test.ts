import { describe, expect, it } from "vitest";
import { SCENE_SECONDS, remainingSceneMs } from "./scene-timing";

describe("loading scene timing", () => {
  const start = 1_000_000;

  it("runs for the full six seconds when auth resolves instantly", () => {
    expect(remainingSceneMs(start, start, false)).toBe(SCENE_SECONDS * 1000);
  });

  it("holds only the remainder when auth took some of the time", () => {
    expect(remainingSceneMs(start, start + 1500, false)).toBe(4500);
  });

  it("does not hold at all once the scene has had its full run", () => {
    expect(remainingSceneMs(start, start + SCENE_SECONDS * 1000, false)).toBe(0);
  });

  it("never returns a negative wait when auth outlasts the animation", () => {
    expect(remainingSceneMs(start, start + 30_000, false)).toBe(0);
  });

  it("skips the wait entirely for reduced motion", () => {
    // There is no animation to watch, so there is nothing to wait for.
    expect(remainingSceneMs(start, start, true)).toBe(0);
  });
});

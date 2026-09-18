import { describe, expect, it } from "vitest";
import { HEADER_HEIGHT, MIN_VISIBLE, clampToViewport, parsePosition } from "./panel-position";

const PANEL = { width: 520, height: 600 };
const SCREEN = { width: 1440, height: 900 };

describe("clampToViewport", () => {
  it("leaves a position that is already on screen alone", () => {
    expect(clampToViewport({ x: 300, y: 120 }, PANEL, SCREEN)).toEqual({ x: 300, y: 120 });
  });

  it("keeps enough of the panel on the right edge to grab it again", () => {
    const { x } = clampToViewport({ x: 5000, y: 100 }, PANEL, SCREEN);

    expect(x).toBe(SCREEN.width - MIN_VISIBLE);
    expect(SCREEN.width - x).toBeGreaterThanOrEqual(MIN_VISIBLE);
  });

  it("lets it hang off the left, but not out of reach", () => {
    // Hanging off the left is useful — it tucks the panel against the edge
    // — so this is a floor, not a ban.
    const { x } = clampToViewport({ x: -5000, y: 100 }, PANEL, SCREEN);

    expect(x).toBe(MIN_VISIBLE - PANEL.width);
    expect(x + PANEL.width).toBe(MIN_VISIBLE);
  });

  it("never lets the header go above the top or below the fold", () => {
    expect(clampToViewport({ x: 100, y: -400 }, PANEL, SCREEN).y).toBe(0);
    expect(clampToViewport({ x: 100, y: 5000 }, PANEL, SCREEN).y).toBe(SCREEN.height - HEADER_HEIGHT);
  });

  it("still leaves the panel reachable on a viewport narrower than the panel", () => {
    // A phone, or a window dragged very small: the two bounds would cross,
    // and an unordered clamp would produce a nonsense position.
    const tiny = { width: 320, height: 480 };
    const { x, y } = clampToViewport({ x: 9999, y: 9999 }, PANEL, tiny);

    expect(x).toBeLessThanOrEqual(tiny.width - MIN_VISIBLE);
    expect(x + PANEL.width).toBeGreaterThanOrEqual(MIN_VISIBLE);
    expect(y).toBeLessThanOrEqual(tiny.height - HEADER_HEIGHT);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  it("rounds to whole pixels, since the result is written to a style", () => {
    expect(clampToViewport({ x: 100.4, y: 55.6 }, PANEL, SCREEN)).toEqual({ x: 100, y: 56 });
  });
});

describe("parsePosition", () => {
  it("reads a saved position back", () => {
    expect(parsePosition('{"x":120,"y":40}')).toEqual({ x: 120, y: 40 });
  });

  it("treats anything that is not two real numbers as no position at all", () => {
    // The panel then renders docked, which is always a usable place to be.
    for (const raw of [null, "", "not json", "[]", '{"x":1}', '{"x":"1","y":2}', '{"x":null,"y":2}']) {
      expect(parsePosition(raw)).toBeNull();
    }
  });
});

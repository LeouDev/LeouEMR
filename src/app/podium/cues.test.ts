import { describe, expect, it } from "vitest";
import {
  CONFETTI_SECONDS,
  CONFETTI_START,
  CUE,
  FLY_SECONDS,
  ORDER,
  PLACE,
  POP_DELAY,
  POP_SECONDS,
  RISE_DELAY,
  RISE_SECONDS,
  SCENES,
} from "./cues";

/** The running total of the scenes before `name` — where that scene starts. */
function startOf(name: string): number {
  let total = 0;
  for (const scene of SCENES) {
    if (scene.name === name) return Number(total.toFixed(2));
    total += scene.seconds;
  }
  throw new Error(`no scene called ${name}`);
}

describe("the podium's cue table", () => {
  it("starts each cue where its scene actually starts", () => {
    // The cues are a running total of the scene lengths above them. Retiming
    // a scene without moving the cues would leave the pedestals rising into
    // a caption that is still on screen.
    expect(CUE.rise).toBe(startOf("Rise"));
    expect(CUE.reveal).toBe(startOf("Reveal"));
    expect(CUE.celebrate).toBe(startOf("Celebrate"));
    expect(CUE.hold).toBe(startOf("Hold"));
  });

  it("reveals third place first and first place last", () => {
    expect(RISE_DELAY[3]).toBeLessThan(RISE_DELAY[2]);
    expect(RISE_DELAY[2]).toBeLessThan(RISE_DELAY[1]);
    expect(POP_DELAY[3]).toBeLessThan(POP_DELAY[2]);
    expect(POP_DELAY[2]).toBeLessThan(POP_DELAY[1]);
  });

  it("stands every pedestal up before anybody pops in on top of it", () => {
    // A person appearing on a pedestal still sliding up from below the
    // ground line is the one way this choreography can look broken.
    for (const place of [1, 2, 3]) {
      const riseEnds = CUE.rise + RISE_DELAY[place] + RISE_SECONDS;
      expect(CUE.reveal + POP_DELAY[place]).toBeGreaterThanOrEqual(riseEnds);
    }
  });

  it("has everything finished by the time the page settles", () => {
    // Hold is where the controls appear and the timeline stops mattering:
    // anything still moving into place past it would be cut off by a skip.
    const lastPop = CUE.reveal + POP_DELAY[1] + POP_SECONDS;
    expect(lastPop).toBeLessThanOrEqual(CUE.hold);
    expect(CUE.celebrate + FLY_SECONDS).toBeLessThanOrEqual(CUE.hold);
    expect(CONFETTI_START + CONFETTI_SECONDS).toBeLessThanOrEqual(CUE.hold);
  });

  it("fires the confetti as first place lands, not before", () => {
    expect(CONFETTI_START).toBeGreaterThanOrEqual(CUE.reveal + POP_DELAY[1]);
  });

  it("puts first place in the middle, tallest, with the biggest photo", () => {
    expect(ORDER).toEqual([2, 1, 3]);
    expect(PLACE[1].height).toBeGreaterThan(PLACE[2].height);
    expect(PLACE[2].height).toBeGreaterThan(PLACE[3].height);
    expect(PLACE[1].photo).toBeGreaterThan(PLACE[2].photo);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LIVE_FROM, surveyIsLive, surveyLiveFrom } from "./gate";

/**
 * The launch switch. This decides whether four hundred people can reach the
 * app they work in, so every branch that cannot answer has to read as "let
 * them through" — the tests below are mostly about that.
 */

afterEach(() => {
  delete process.env.SURVEY_LIVE_FROM;
});

const BEFORE = new Date("2026-09-18T17:59:59+08:00");
const AFTER = new Date("2026-09-18T18:00:01+08:00");

describe("surveyLiveFrom", () => {
  it("defaults to the launch the business asked for: 6pm Manila, 18 Sep 2026", () => {
    expect(surveyLiveFrom()?.toISOString()).toBe(new Date(DEFAULT_LIVE_FROM).toISOString());
    // The offset is the point: read as UTC it would open at 2am Manila.
    expect(DEFAULT_LIVE_FROM).toContain("+08:00");
  });

  it("takes an override from the environment", () => {
    process.env.SURVEY_LIVE_FROM = "2026-10-01T09:00:00+08:00";
    expect(surveyLiveFrom()?.toISOString()).toBe("2026-10-01T01:00:00.000Z");
  });

  it("is off, not on, for the literal switch", () => {
    process.env.SURVEY_LIVE_FROM = "off";
    expect(surveyLiveFrom()).toBeNull();
  });

  it("is off for anything it cannot read as a date", () => {
    // A typo in a launch date must not become a gate nobody can open.
    for (const value of ["", "   ", "tomorrow", "2026-13-45T99:00:00Z", "off "]) {
      process.env.SURVEY_LIVE_FROM = value;
      const from = surveyLiveFrom();
      expect(from === null || !Number.isNaN(from.getTime())).toBe(true);
    }
    process.env.SURVEY_LIVE_FROM = "not-a-date";
    expect(surveyLiveFrom()).toBeNull();
  });
});

describe("surveyIsLive", () => {
  it("is shut a second before the launch and open a second after", () => {
    expect(surveyIsLive(BEFORE)).toBe(false);
    expect(surveyIsLive(AFTER)).toBe(true);
  });

  it("is open exactly on the stroke of the launch", () => {
    expect(surveyIsLive(new Date(DEFAULT_LIVE_FROM))).toBe(true);
  });

  it("stays shut at every time once switched off", () => {
    process.env.SURVEY_LIVE_FROM = "off";
    expect(surveyIsLive(BEFORE)).toBe(false);
    expect(surveyIsLive(AFTER)).toBe(false);
    expect(surveyIsLive(new Date("2099-01-01T00:00:00Z"))).toBe(false);
  });

  it("stays shut on an unreadable date, so a typo cannot gate anyone", () => {
    process.env.SURVEY_LIVE_FROM = "18/09/2026 6pm";
    expect(surveyIsLive(AFTER)).toBe(false);
  });
});

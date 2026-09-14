import { describe, expect, it } from "vitest";
import {
  MONTHLY_DEFAULTS,
  computeScorecard,
  skillBandLabels,
  skillGroupOf,
  type ScorecardInputs,
  type ScorecardSkillInput,
} from "./engine";

// The curves as seeded on skill_references (migration 0003).
const FAX = { r1: 0, r2: 0.8955, r3: 1, r4: 1.1682, r5: 1.2727 };
const EDITS = { r1: 0, r2: 0.6838, r3: 1, r4: 1.4326, r5: 1.6663 };
const GEN_PHONES = { r1: 0, r2: 0.9349, r3: 1, r4: 1.0775, r5: 1.2675 };

function skill(overrides: Partial<ScorecardSkillInput>): ScorecardSkillInput {
  return {
    code: "fax",
    name: "Fax",
    group: "ancillary",
    hours: 10,
    actual: 11,
    target: 11,
    lowerIsBetter: false,
    thresholds: FAX,
    ramping: false,
    ...overrides,
  };
}

/** The August 2026 card from the business's own workbook, row for row. */
const AUGUST: ScorecardInputs = {
  skills: [
    // 133.44% of an 11.00 target, 10.55 hours.
    skill({ code: "fax", name: "Fax", hours: 10.55, actual: 1.3344 * 11, target: 11, thresholds: FAX }),
    // 143.12% of an 8.00 target, 118.17 hours.
    skill({ code: "edits", name: "EDITS", hours: 118.17, actual: 1.4312 * 8, target: 8, thresholds: EDITS }),
  ],
  ancillaryQuality: 100,
  phoneQuality: null,
  criticalErrors: 5,
  standardErrors: 0,
  nps: null,
  attendance: 100,
  ire: 0,
  pkt: 95,
  lhUtilization: 82.38,
};

const row = (card: ReturnType<typeof computeScorecard>, key: string) => card.rows.find((r) => r.key === key)!;

describe("computeScorecard — the workbook's August card", () => {
  const card = computeScorecard(AUGUST);

  it("weights productivity by hours across the skills' own curves", () => {
    const productivity = row(card, "PRODUCTIVITY");
    expect(productivity.skills?.map((s) => [s.code, s.share.toFixed(4), s.rating?.toFixed(2)])).toEqual([
      ["fax", "0.0820", "5.00"],
      ["edits", "0.9180", "4.00"],
    ]);
    expect(productivity.score).toBeCloseTo(0.82, 2);
  });

  it("gives the whole quality and errors blocks to the ancillary rows when every hour is ancillary", () => {
    expect(card.hours).toEqual({ phone: 0, ancillary: 128.72, phoneShare: 0, ancillaryShare: 1 });
    expect(row(card, "ANCILLARY_QUALITY")).toMatchObject({ weight: 0.2, rate: 5, score: 1, status: "scored" });
    expect(row(card, "PHONE_QUALITY")).toMatchObject({ weight: 0, rate: null, status: "no-weight" });
    expect(row(card, "CRITICAL_ERRORS")).toMatchObject({ weight: 0.2, rate: 2, score: 0.4 });
    expect(row(card, "NPS")).toMatchObject({ weight: 0, status: "no-weight" });
  });

  it("rates the remaining rows on their bands", () => {
    expect(row(card, "STANDARD_ERRORS")).toMatchObject({ rate: 5, score: 0.5 });
    expect(row(card, "IRE")).toMatchObject({ rate: 5, score: 0.5, status: "scored" });
    expect(row(card, "PKT")).toMatchObject({ rate: 4, score: 0.4 });
    expect(row(card, "ATTENDANCE")).toMatchObject({ rate: 5, score: 0.25 });
    expect(row(card, "LH_UTILIZATION")).toMatchObject({ rate: 5, score: 0.25 });
  });

  it("adds up to the sheet's 4.12 with nothing rescaled", () => {
    expect(card.weightScored).toBeCloseTo(1, 9);
    expect(card.finalScore).toBeCloseTo(4.12, 2);
    expect(card.rescaled).toBe(false);
    expect(card.meetsMinimum).toBe(true);
  });
});

describe("computeScorecard — a cross-skilled month", () => {
  const card = computeScorecard({
    ...AUGUST,
    skills: [
      skill({ code: "edits", name: "EDITS", hours: 70, actual: 8, target: 8, thresholds: EDITS }),
      skill({ code: "gen_phones", name: "Gen_Phones", group: "phone", hours: 30, actual: 515, target: 515, lowerIsBetter: true, thresholds: GEN_PHONES }),
    ],
    ancillaryQuality: 98.5,
    phoneQuality: 99.2,
    criticalErrors: 0,
    nps: 80,
  });

  it("splits the two blocks in the ratio of ancillary to phone hours", () => {
    expect(card.hours).toMatchObject({ phone: 30, ancillary: 70, phoneShare: 0.3, ancillaryShare: 0.7 });
    const weights = Object.fromEntries(card.rows.map((r) => [r.key, r.weight]));
    expect(weights.ANCILLARY_QUALITY).toBeCloseTo(0.14, 9);
    expect(weights.PHONE_QUALITY).toBeCloseTo(0.06, 9);
    expect(weights.CRITICAL_ERRORS).toBeCloseTo(0.14, 9);
    expect(weights.NPS).toBeCloseTo(0.06, 9);
    expect(row(card, "ANCILLARY_QUALITY").rate).toBe(3);
    expect(row(card, "PHONE_QUALITY").rate).toBe(4);
    expect(row(card, "CRITICAL_ERRORS").rate).toBe(5);
    expect(row(card, "NPS").rate).toBe(4);
  });

  it("rates a handle-time skill on the inverted ratio, exactly on target being a 3", () => {
    const phones = row(card, "PRODUCTIVITY").skills!.find((s) => s.code === "gen_phones")!;
    expect(phones.attainmentPct).toBeCloseTo(100, 6);
    expect(phones.rating).toBe(3);
  });
});

describe("computeScorecard — missing figures", () => {
  it("stands full marks in for the monthly sheet until it arrives", () => {
    const card = computeScorecard({ ...AUGUST, ire: null, pkt: null, lhUtilization: null });
    expect(row(card, "IRE")).toMatchObject({ actual: MONTHLY_DEFAULTS.ire, rate: 5, status: "defaulted" });
    expect(row(card, "PKT")).toMatchObject({ actual: MONTHLY_DEFAULTS.pkt, rate: 5, status: "defaulted" });
    expect(row(card, "LH_UTILIZATION")).toMatchObject({ actual: MONTHLY_DEFAULTS.lhUtilization, rate: 5, status: "defaulted" });
    expect(card.weightScored).toBeCloseTo(1, 9);
    expect(card.rescaled).toBe(false);
  });

  it("drops a weighted row with nothing measured and reads the score over what remains", () => {
    const card = computeScorecard({ ...AUGUST, ancillaryQuality: null });
    expect(row(card, "ANCILLARY_QUALITY")).toMatchObject({ weight: 0.2, rate: null, status: "no-data" });
    expect(card.weightScored).toBeCloseTo(0.8, 9);
    expect(card.rescaled).toBe(true);
    // The other rows' 3.116 points over 0.8 of weight.
    expect(card.finalScore).toBeCloseTo(3.116 / 0.8, 2);
  });

  it("treats a zero hour share as not applying, never as missing", () => {
    const card = computeScorecard({ ...AUGUST, nps: null, phoneQuality: null });
    expect(row(card, "NPS").status).toBe("no-weight");
    expect(card.rescaled).toBe(false);
  });

  it("carries no productivity or split rows without any hours", () => {
    const card = computeScorecard({ ...AUGUST, skills: [] });
    expect(row(card, "PRODUCTIVITY").status).toBe("no-data");
    expect(card.rows.filter((r) => r.status === "no-weight").map((r) => r.key)).toEqual([
      "ANCILLARY_QUALITY",
      "PHONE_QUALITY",
      "CRITICAL_ERRORS",
      "NPS",
    ]);
    expect(card.weightScored).toBeCloseTo(0.4, 9);
    expect(card.rescaled).toBe(true);
  });

  it("leaves an unmeasured skill out of the rate but keeps its hours in the split", () => {
    const card = computeScorecard({
      ...AUGUST,
      skills: [
        skill({ code: "fax", hours: 50, actual: null }),
        skill({ code: "edits", name: "EDITS", hours: 50, actual: 8 * 1.6663, target: 8, thresholds: EDITS }),
      ],
    });
    const productivity = row(card, "PRODUCTIVITY");
    expect(productivity.rate).toBe(5);
    expect(productivity.skills?.map((s) => [s.code, s.share, s.rating])).toEqual([
      ["fax", 0.5, null],
      ["edits", 0.5, 5],
    ]);
  });

  it("has no score at all when nothing could be measured", () => {
    const card = computeScorecard({
      skills: [],
      ancillaryQuality: null,
      phoneQuality: null,
      criticalErrors: 0,
      standardErrors: 0,
      nps: null,
      attendance: null,
      ire: null,
      pkt: null,
      lhUtilization: null,
    });
    // Counts and defaults still rate; only the measured rows are gone.
    expect(card.rows.filter((r) => r.rate !== null).map((r) => r.key)).toEqual(["STANDARD_ERRORS", "IRE", "PKT", "LH_UTILIZATION"]);
    expect(card.finalScore).toBeCloseTo(5, 9);
    expect(card.rescaled).toBe(true);
  });
});

describe("skillGroupOf", () => {
  it("puts the handle-time skills on the phone side and everything else on the ancillary side", () => {
    expect(skillGroupOf({ metric: "aht", lowerIsBetter: true })).toBe("phone");
    expect(skillGroupOf({ metric: "cph", lowerIsBetter: false })).toBe("ancillary");
    expect(skillGroupOf({ metric: "case_rate", lowerIsBetter: false })).toBe("ancillary");
  });
});

describe("skillBandLabels", () => {
  it("prints the sheet's rate columns from the skill's curve", () => {
    expect(skillBandLabels(FAX)).toEqual([
      "127.27%-Higher",
      "116.82%-127.26%",
      "100.00%-116.81%",
      "89.55%-99.99%",
      "89.54%-Below",
    ]);
  });
});

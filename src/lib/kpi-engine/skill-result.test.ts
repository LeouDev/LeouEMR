import { describe, expect, it } from "vitest";
import { MIN_SKILL_HOURS, foldSkillRows, measureSkill, measureSkillWeek, skillKpiCode } from "./skill-result";

describe("skillKpiCode", () => {
  it("prefixes and upper-cases the skill's own code", () => {
    expect(skillKpiCode("gen_phones")).toBe("SKILL_GEN_PHONES");
    expect(skillKpiCode("am_cancellation_wb")).toBe("SKILL_AM_CANCELLATION_WB");
  });
});

describe("measureSkill", () => {
  it("uses each metric's own formula", () => {
    const week = { cases: 40, hours: 4, prodWeight: 480 };
    expect(measureSkill("cph", week)).toBe(10);
    expect(measureSkill("aht", week)).toBe(360);
    expect(measureSkill("case_rate", week)).toBe(12);
  });

  it("has no value without the quantity the formula divides by", () => {
    expect(measureSkill("cph", { cases: 5, hours: 0, prodWeight: 0 })).toBeNull();
    expect(measureSkill("aht", { cases: 0, hours: 3, prodWeight: 0 })).toBeNull();
    expect(measureSkill("case_rate", { cases: 3, hours: 1, prodWeight: 0 })).toBeNull();
  });
});

describe("measureSkillWeek", () => {
  it("returns the actual and the target the week was held to", () => {
    expect(measureSkillWeek("cph", { cases: 40, hours: 4, prodWeight: 0 }, 11)).toEqual({
      actual: 10,
      target: 11,
    });
  });

  it("does not judge a week with too little time on the skill", () => {
    const thin = { cases: 3, hours: MIN_SKILL_HOURS - 0.25, prodWeight: 0 };
    expect(measureSkillWeek("cph", thin, 11)).toBeNull();
    expect(measureSkillWeek("aht", thin, 500)).toBeNull();
    expect(measureSkillWeek("cph", { ...thin, hours: MIN_SKILL_HOURS }, 11)).not.toBeNull();
  });

  it("judges a case-rate skill on cases, not hours", () => {
    expect(measureSkillWeek("case_rate", { cases: 3, hours: 0, prodWeight: 30 }, 11)).toEqual({
      actual: 10,
      target: 11,
    });
  });

  it("needs a positive target and at least one case", () => {
    expect(measureSkillWeek("cph", { cases: 40, hours: 4, prodWeight: 0 }, undefined)).toBeNull();
    expect(measureSkillWeek("cph", { cases: 40, hours: 4, prodWeight: 0 }, 0)).toBeNull();
    expect(measureSkillWeek("cph", { cases: 0, hours: 4, prodWeight: 0 }, 11)).toBeNull();
  });
});

describe("foldSkillRows", () => {
  const FAX = { code: "FAX" };
  const PHONES = { code: "PARTD_PHONES" };
  const resolve = (row: { label: string }) =>
    ({ fax: FAX, "uhcwest fax": FAX, partd_phones: PHONES })[row.label.toLowerCase()];

  it("sums every spelling of a skill into one row, keeping the first row's other fields", () => {
    const { folded, unmatched } = foldSkillRows(
      [
        { label: "Fax", cases: 98, hours: 16.1, prodWeight: 20, weightHours: 40, cphTarget: 6 },
        { label: "UHCWest Fax", cases: 113, hours: 13.5, prodWeight: 30, weightHours: 38, cphTarget: 6 },
        { label: "PartD_Phones", cases: 5, hours: 1, prodWeight: 0, weightHours: 2, cphTarget: 4 },
      ],
      resolve,
    );
    expect(unmatched).toEqual([]);
    expect(folded).toEqual([
      {
        ref: FAX,
        row: { label: "Fax", cases: 211, hours: 29.6, prodWeight: 50, weightHours: 78, cphTarget: 6 },
      },
      {
        ref: PHONES,
        row: { label: "PartD_Phones", cases: 5, hours: 1, prodWeight: 0, weightHours: 2, cphTarget: 4 },
      },
    ]);
  });

  it("does not touch the rows it was given", () => {
    const first = { label: "Fax", cases: 1, hours: 1, prodWeight: 1 };
    foldSkillRows([first, { label: "UHCWest Fax", cases: 2, hours: 2, prodWeight: 2 }], resolve);
    expect(first).toEqual({ label: "Fax", cases: 1, hours: 1, prodWeight: 1 });
  });

  it("hands back the rows no configured skill answers to", () => {
    const { folded, unmatched } = foldSkillRows(
      [
        { label: "Mystery", cases: 1, hours: 1, prodWeight: 1 },
        { label: "Fax", cases: 1, hours: 1, prodWeight: 1 },
      ],
      resolve,
    );
    expect(folded.map((f) => f.ref.code)).toEqual(["FAX"]);
    expect(unmatched.map((r) => r.label)).toEqual(["Mystery"]);
  });
});

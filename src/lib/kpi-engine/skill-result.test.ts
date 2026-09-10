import { describe, expect, it } from "vitest";
import { MIN_SKILL_HOURS, measureSkill, measureSkillWeek, skillKpiCode } from "./skill-result";

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

import { describe, expect, it } from "vitest";
import { ahtChartRows, cphChartRows, type SkillSupervisorRow } from "./skill-supervisor-breakdown";

/**
 * Which skills belong on which of the two supervisor breakdown charts.
 * Before this, both charts plotted every skill regardless of how it's
 * scored — an AHT skill's raw seconds-per-case figure (hundreds) sharing an
 * axis with cases-per-hour figures (single digits) is what produced the
 * huge, meaningless spikes on the cases-per-hour chart.
 */

const row = (over: Partial<SkillSupervisorRow>): SkillSupervisorRow => ({
  supervisor: "Reyes, Kristian",
  skillCode: "fax",
  skillName: "Fax",
  hours: 10,
  cases: 50,
  cph: 5,
  aht: 720,
  metric: "cph",
  lowerIsBetter: false,
  ...over,
});

describe("cphChartRows", () => {
  it("keeps a case_rate skill — case rate reduces to the same cases-per-hour figure", () => {
    const rows = [row({ skillCode: "glp_1", metric: "case_rate", lowerIsBetter: false })];
    expect(cphChartRows(rows)).toEqual(rows);
  });

  it("keeps a plain cph skill", () => {
    const rows = [row({ skillCode: "fax", metric: "cph", lowerIsBetter: false })];
    expect(cphChartRows(rows)).toEqual(rows);
  });

  it("drops an AHT skill — a lower number is the good direction there, not a higher one", () => {
    const rows = [row({ skillCode: "phones", metric: "aht", lowerIsBetter: true })];
    expect(cphChartRows(rows)).toEqual([]);
  });

  it("keeps some and drops others in the same call", () => {
    const cph = row({ skillCode: "fax", metric: "cph", lowerIsBetter: false });
    const aht = row({ skillCode: "phones", metric: "aht", lowerIsBetter: true });
    expect(cphChartRows([cph, aht])).toEqual([cph]);
  });
});

describe("ahtChartRows", () => {
  it("keeps a genuine AHT skill", () => {
    const rows = [row({ skillCode: "phones", metric: "aht", lowerIsBetter: true })];
    expect(ahtChartRows(rows)).toEqual(rows);
  });

  it("drops a skill gauged by cases per hour", () => {
    const rows = [row({ skillCode: "fax", metric: "cph", lowerIsBetter: false })];
    expect(ahtChartRows(rows)).toEqual([]);
  });

  it("drops a skill gauged by case rate", () => {
    const rows = [row({ skillCode: "glp_1", metric: "case_rate", lowerIsBetter: false })];
    expect(ahtChartRows(rows)).toEqual([]);
  });

  it("keeps some and drops others in the same call", () => {
    const cph = row({ skillCode: "fax", metric: "cph", lowerIsBetter: false });
    const aht = row({ skillCode: "phones", metric: "aht", lowerIsBetter: true });
    expect(ahtChartRows([cph, aht])).toEqual([aht]);
  });
});

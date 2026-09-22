import { describe, expect, it } from "vitest";
import { autoFlags, autoMetricsByEmployee, deriveAutoIndicators, EMPTY_AUTO_METRICS, isAutoIndicator } from "./auto-indicators";

describe("deriveAutoIndicators", () => {
  it("flags an absence, low PAR and a QA or NPS drop from the figures", () => {
    const auto = deriveAutoIndicators({
      attendance: 80,
      productionRate: 2.55,
      quality: 88,
      previousQuality: 90,
      nps: 60,
      previousNps: 60,
    });
    expect(autoFlags(auto)).toEqual({ absent: true, lowprod: true, qadrop: true });
    expect(auto.absent.caption).toBe("Attendance 80% (flags below 100%)");
    expect(auto.lowprod.caption).toBe("PAR 2.55 (flags below 2.99)");
    expect(auto.qadrop.caption).toBe("QA 88% (prev 90%) · NPS 60 (prev 60) — flags a drop on either");
  });

  it("flags nothing when the figures are clean, or when there is no figure", () => {
    const clean = deriveAutoIndicators({
      attendance: 100,
      productionRate: 3.05,
      quality: 90,
      previousQuality: 90,
      nps: 70,
      previousNps: 60,
    });
    expect(autoFlags(clean)).toEqual({ absent: false, lowprod: false, qadrop: false });

    const none = deriveAutoIndicators(EMPTY_AUTO_METRICS);
    expect(autoFlags(none)).toEqual({ absent: false, lowprod: false, qadrop: false });
    expect(none.absent.caption).toBe("No attendance this week");
    expect(none.lowprod.caption).toBe("No PAR this week");
    expect(none.qadrop.caption).toBe("No QA or NPS this week");
  });

  it("needs both weeks to call a decline, and an NPS drop alone is enough", () => {
    const firstWeek = deriveAutoIndicators({ ...EMPTY_AUTO_METRICS, quality: 70, nps: 40 });
    expect(firstWeek.qadrop.on).toBe(false);
    expect(firstWeek.qadrop.caption).toBe("QA 70% · NPS 40 — flags a drop on either");

    const npsOnly = deriveAutoIndicators({ ...EMPTY_AUTO_METRICS, nps: 40, previousNps: 50 });
    expect(npsOnly.qadrop.on).toBe(true);
  });

  it("names the three codes and no other", () => {
    expect(isAutoIndicator("absent")).toBe(true);
    expect(isAutoIndicator("tardy")).toBe(false);
  });
});

describe("autoMetricsByEmployee", () => {
  it("folds the two weeks' figures per person, this week's on their own and last week's as the comparison", () => {
    const current = [
      { employeeId: "a", kpiCode: "ATTENDANCE", actualValue: 80 },
      { employeeId: "a", kpiCode: "PRODUCTION_RATE", actualValue: 2.5 },
      { employeeId: "a", kpiCode: "QUALITY", actualValue: 88 },
      { employeeId: "a", kpiCode: "NPS", actualValue: 50 },
      { employeeId: "a", kpiCode: "MBO", actualValue: 33 },
      { employeeId: "b", kpiCode: "QUALITY", actualValue: 95 },
    ];
    const previous = [
      { employeeId: "a", kpiCode: "QUALITY", actualValue: 90 },
      { employeeId: "a", kpiCode: "ATTENDANCE", actualValue: 100 },
      { employeeId: "c", kpiCode: "NPS", actualValue: 10 },
    ];
    const by = autoMetricsByEmployee(current, previous);
    expect(by.get("a")).toEqual({ attendance: 80, productionRate: 2.5, quality: 88, previousQuality: 90, nps: 50, previousNps: null });
    expect(by.get("b")).toEqual({ ...EMPTY_AUTO_METRICS, quality: 95 });
    expect(by.get("c")).toEqual({ ...EMPTY_AUTO_METRICS, previousNps: 10 });
  });
});

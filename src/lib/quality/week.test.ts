import { describe, expect, it } from "vitest";
import {
  AUDITS_PER_AGENT,
  auditWeekOf,
  daysCovered,
  isAuditWeekStart,
  requiredFor,
  shiftWeek,
  standingFor,
  weekLabel,
} from "./week";

describe("auditWeekOf", () => {
  it("runs Sunday to Saturday, unlike the Saturday-to-Friday reporting week", () => {
    expect(auditWeekOf("2026-09-13")).toEqual({ start: "2026-09-13", end: "2026-09-19" }); // a Sunday
    expect(auditWeekOf("2026-09-12")).toEqual({ start: "2026-09-06", end: "2026-09-12" }); // a Saturday
    expect(auditWeekOf("2026-09-09")).toEqual({ start: "2026-09-06", end: "2026-09-12" });
  });

  it("steps whole weeks and recognises a start date", () => {
    expect(shiftWeek(auditWeekOf("2026-09-09"), 1)).toEqual({ start: "2026-09-13", end: "2026-09-19" });
    expect(shiftWeek(auditWeekOf("2026-09-09"), -1)).toEqual({ start: "2026-08-30", end: "2026-09-05" });
    expect(isAuditWeekStart("2026-09-06")).toBe(true);
    expect(isAuditWeekStart("2026-09-07")).toBe(false);
    expect(isAuditWeekStart(undefined)).toBe(false);
  });

  it("labels the week with the year once", () => {
    expect(weekLabel(auditWeekOf("2026-09-09"))).toBe("Sep 6 – Sep 12, 2026");
  });
});

describe("standingFor", () => {
  const week = auditWeekOf("2026-09-09");
  const active = { status: "active" as const, separatedOn: null, leave: [] };

  it("owes two audits when active and nothing else", () => {
    expect(standingFor(active, week)).toBe("active");
    expect(requiredFor("active")).toBe(AUDITS_PER_AGENT);
  });

  it("is out all week only when approved leave covers every one of the seven days", () => {
    const partial = { ...active, leave: [{ start: "2026-09-07", end: "2026-09-11" }] };
    expect(daysCovered(week, partial.leave)).toBe(5);
    expect(standingFor(partial, week)).toBe("active");

    const whole = { ...active, leave: [{ start: "2026-09-01", end: "2026-09-08" }, { start: "2026-09-09", end: "2026-09-20" }] };
    expect(daysCovered(week, whole.leave)).toBe(7);
    expect(standingFor(whole, week)).toBe("out_all_week");
    expect(requiredFor("out_all_week")).toBe(0);
  });

  it("does not owe audits once separated before the week, but still does in the week they leave", () => {
    expect(standingFor({ ...active, separatedOn: "2026-09-05" }, week)).toBe("separated");
    expect(standingFor({ ...active, separatedOn: "2026-09-09" }, week)).toBe("active");
    expect(standingFor({ ...active, status: "separated", separatedOn: null }, week)).toBe("separated");
  });

  it("treats a leave of absence as out", () => {
    expect(standingFor({ ...active, status: "on_leave" }, week)).toBe("on_leave");
    expect(requiredFor("on_leave")).toBe(0);
  });
});

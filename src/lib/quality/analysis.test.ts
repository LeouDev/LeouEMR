import { describe, expect, it } from "vitest";
import { summarize, windowFor, windowLabel, type AuditSummary, type FailSummary } from "./analysis";

const TODAY = "2026-09-13";

function audit(over: Partial<AuditSummary> & { id: string; auditDate: string; scorePct: number }): AuditSummary {
  return { agentName: "Agent", supervisorName: "Lopez, Ana", managerName: "Cruz, Ben", isCritical: false, formKey: "phones", formLabel: "Phones", ...over };
}

describe("windowFor", () => {
  it("takes the last 14 days for the daily view and the equal span before it as the prior period", () => {
    const w = windowFor("daily", TODAY);
    expect(w.buckets).toHaveLength(14);
    expect(w.start).toBe("2026-08-31");
    expect(w.end).toBe(TODAY);
    expect(w.priorStart).toBe("2026-08-17");
    expect(w.priorEnd).toBe("2026-08-30");
    expect(w.buckets[13].label).toBe("Sep 13");
  });

  it("takes twelve Sunday-to-Saturday weeks ending in the current one", () => {
    const w = windowFor("weekly", TODAY);
    expect(w.buckets).toHaveLength(12);
    expect(w.buckets[11]).toMatchObject({ start: "2026-09-13", end: "2026-09-19" });
    expect(w.buckets[0].start).toBe("2026-06-28");
    expect(windowLabel(w)).toBe("Jun 28 – Sep 19, 2026");
  });

  it("takes twelve calendar months ending in the current one", () => {
    const w = windowFor("monthly", TODAY);
    expect(w.buckets[11]).toMatchObject({ start: "2026-09-01", end: "2026-09-30", label: "Sep 26" });
    expect(w.buckets[0]).toMatchObject({ start: "2025-10-01", end: "2025-10-31" });
  });
});

describe("summarize", () => {
  const window = windowFor("daily", TODAY);
  const audits = [
    audit({ id: "a", auditDate: "2026-09-10", scorePct: 96 }),
    audit({ id: "b", auditDate: "2026-09-10", scorePct: 80 }),
    audit({ id: "c", auditDate: "2026-09-12", scorePct: 0, isCritical: true, supervisorName: "Tan, Bea", formKey: "fax", formLabel: "PANDA Fax" }),
    audit({ id: "d", auditDate: "2026-09-12", scorePct: 100, supervisorName: "Tan, Bea", managerName: "Reyes, Cy", formKey: "fax", formLabel: "PANDA Fax" }),
    // Prior window: feeds the deltas, never the charts.
    audit({ id: "p1", auditDate: "2026-08-20", scorePct: 60 }),
    audit({ id: "p2", auditDate: "2026-08-25", scorePct: 0, isCritical: true }),
    // Outside both windows: ignored entirely.
    audit({ id: "old", auditDate: "2026-01-01", scorePct: 10 }),
  ];
  const fails: FailSummary[] = [
    { auditId: "b", category: "Documentation", attribute: "a. Did not select appropriate dropdown options", isCompliance: false },
    { auditId: "b", category: "Closing", attribute: "b. Did not offer/mention survey", isCompliance: false },
    { auditId: "c", category: "Compliance", attribute: "Wrong member selected", isCompliance: true },
    { auditId: "c", category: "Documentation", attribute: "a. Did not select appropriate dropdown options", isCompliance: false },
    { auditId: "p1", category: "Closing", attribute: "b. Did not offer/mention survey", isCompliance: false },
  ];

  const result = summarize(audits, fails, window, "leader");

  it("counts, averages and rates only the window's own audits", () => {
    expect(result.total).toBe(4);
    expect(result.kpis.map((k) => k.value)).toEqual(["4", "69.0%", "50%", "1"]);
  });

  it("words every delta against the prior period and knows which way is good", () => {
    expect(result.kpis[0]).toMatchObject({ delta: "▲ +2 vs prior period", improved: true });
    expect(result.kpis[1]).toMatchObject({ delta: "▲ +39.0 pts vs prior period", improved: true });
    expect(result.kpis[2]).toMatchObject({ delta: "▲ +50 pts vs prior period", improved: true });
    expect(result.kpis[3]).toMatchObject({ delta: "▲ +0 vs prior period", improved: true });
  });

  it("plots the trend per bucket with a gap where nothing was audited", () => {
    const sep10 = result.trend.buckets.indexOf("Sep 10");
    const sep11 = result.trend.buckets.indexOf("Sep 11");
    const sep12 = result.trend.buckets.indexOf("Sep 12");
    expect(result.trend.scores[sep10]).toBe(88);
    expect(result.trend.scores[sep11]).toBeNull();
    expect(result.trend.scores[sep12]).toBe(50);
    expect(result.trend.criticals[sep12]).toBe(1);
  });

  it("groups by team leader or manager, best average first, with the audit count", () => {
    expect(result.groups).toEqual([
      { label: "Lopez, Ana", avg: 88, count: 2 },
      { label: "Tan, Bea", avg: 50, count: 2 },
    ]);
    expect(summarize(audits, fails, window, "manager").groups).toEqual([
      { label: "Reyes, Cy", avg: 100, count: 1 },
      { label: "Cruz, Ben", avg: 58.7, count: 3 },
    ]);
  });

  it("splits outcomes into passed, failed and critical", () => {
    expect(result.outcome).toEqual({ passed: 2, failed: 1, critical: 1 });
  });

  it("ranks error categories and recurring findings by failure count, window only", () => {
    expect(result.categories).toEqual([
      { label: "Documentation", count: 2 },
      { label: "Closing", count: 1 },
      { label: "Compliance", count: 1 },
    ]);
    expect(result.findings[0]).toEqual({ label: "Documentation: a. Did not select appropriate dropdown options", count: 2 });
    expect(result.findings).toHaveLength(3);
  });

  it("lists the forms audited in the window with their audit and failure counts", () => {
    expect(result.forms).toEqual([
      { key: "fax", label: "PANDA Fax", audits: 2, fails: 2 },
      { key: "phones", label: "Phones", audits: 2, fails: 2 },
    ]);
    expect(result.form).toBeNull();
  });

  it("opens every failed category onto the attributes failed under it", () => {
    expect(result.drill[0]).toEqual({
      label: "Documentation",
      count: 2,
      share: 50,
      attributes: [{ label: "a. Did not select appropriate dropdown options", count: 2 }],
    });
    expect(result.drill.map((d) => d.label)).toEqual(["Documentation", "Closing", "Compliance"]);
  });

  it("narrows the failure lists to one form when asked, and to every form for one it has not seen", () => {
    const fax = summarize(audits, fails, window, "leader", "fax");
    expect(fax.form).toBe("fax");
    expect(fax.categories).toEqual([
      { label: "Compliance", count: 1 },
      { label: "Documentation", count: 1 },
    ]);
    expect(fax.drill.map((d) => [d.label, d.share])).toEqual([["Compliance", 50], ["Documentation", 50]]);
    expect(fax.findings).toHaveLength(2);
    // The rest of the page is the whole team's: the KPIs do not narrow.
    expect(fax.total).toBe(4);

    const unknown = summarize(audits, fails, window, "leader", "retired-form");
    expect(unknown.form).toBeNull();
    expect(unknown.categories).toEqual(result.categories);
  });

  it("says nothing to compare when both windows are empty", () => {
    const empty = summarize([], [], window, "leader");
    expect(empty.kpis.map((k) => k.delta)).toEqual([null, null, null, null]);
    expect(empty.kpis[1].value).toBe("—");
    expect(empty.trend.scores.every((v) => v === null)).toBe(true);
  });
});

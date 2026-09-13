import { describe, expect, it } from "vitest";
import { actionItemLinks, cellKey, linkTitle, type TrackedIssue } from "./item-links";

const issue = (over: Partial<TrackedIssue> & { actionItemId: string; kpiCode: string }): TrackedIssue => ({
  actionItemCode: `PA-${over.actionItemId}`,
  status: "OPEN",
  openedWeek: "2026-07-11",
  history: new Map([
    ["2026-07-11", { result: "fail", consecutiveCountAfter: 0 }],
    ["2026-07-18", { result: "pass", consecutiveCountAfter: 0 }],
    ["2026-07-25", { result: "pass", consecutiveCountAfter: 1 }],
  ]),
  noteWeeks: new Set(["2026-07-25"]),
  ...over,
});

describe("actionItemLinks", () => {
  it("links every week an item evaluated, and only those", () => {
    const links = actionItemLinks([issue({ actionItemId: "a", kpiCode: "AHT" })]);
    expect([...links.keys()]).toEqual(["AHT|2026-07-11", "AHT|2026-07-18", "AHT|2026-07-25"]);
    expect(links.get(cellKey("AHT", "2026-08-01"))).toBeUndefined();
    expect(links.get(cellKey("QUALITY", "2026-07-11"))).toBeUndefined();
  });

  it("reads each week the way the old grid did: opened, failed, counted, noted", () => {
    const links = actionItemLinks([issue({ actionItemId: "a", kpiCode: "AHT" })]);
    expect(links.get("AHT|2026-07-11")).toMatchObject({ actionItemId: "a", failed: true, opened: true, counted: false });
    expect(links.get("AHT|2026-07-18")).toMatchObject({ failed: false, counted: false, noted: false });
    expect(links.get("AHT|2026-07-25")).toMatchObject({ failed: false, counted: true, consecutiveCountAfter: 1, noted: true });
    expect(linkTitle(links.get("AHT|2026-07-11")!)).toBe("PA-a · Failed — the week this item opened. Open the action item.");
    expect(linkTitle(links.get("AHT|2026-07-18")!)).toContain("does not count");
    expect(linkTitle(links.get("AHT|2026-07-25")!)).toContain("note against the root cause");
  });

  it("lets the live episode win a week two episodes both cover", () => {
    const closed = issue({ actionItemId: "old", kpiCode: "AHT", status: "COMPLETED" });
    const live = issue({ actionItemId: "new", kpiCode: "AHT", openedWeek: "2026-07-25" });
    expect(actionItemLinks([closed, live]).get("AHT|2026-07-25")?.actionItemId).toBe("new");
    expect(actionItemLinks([live, closed]).get("AHT|2026-07-25")?.actionItemId).toBe("new");
  });
});

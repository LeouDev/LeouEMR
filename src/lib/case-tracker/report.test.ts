import { describe, expect, it } from "vitest";
import { caseLogCsv, eodBody, eodHtml, summaryCsv } from "./report";
import { summarizeDay, type ActivityBlock, type LoggedCase, type SkillTarget } from "./tracker";

const TARGETS = new Map<string, SkillTarget>([
  ["fax", { code: "fax", name: "Fax", target: 11, rampStageLabel: null }],
  ["outreach", { code: "outreach", name: "Outreach", target: 9.5, rampStageLabel: "Week 2" }],
]);

const block = (over: Partial<ActivityBlock> = {}): ActivityBlock => ({
  id: "b",
  date: "2026-09-08",
  activity: "CSBO-PA-OGS Fax",
  start: "09:00",
  end: "11:00",
  skillCode: "fax",
  ...over,
});

const logged = (over: Partial<LoggedCase> = {}): LoggedCase => ({
  id: "c",
  date: "2026-09-08",
  caseNumber: "PA-1",
  skillCode: "fax",
  decision: "Approved",
  activeApproval: "N",
  cancellationNote: "N",
  urgent: "Y",
  quantityLimit: "Y",
  loggedAt: "09:10:00",
  ...over,
});

describe("case log csv", () => {
  it("names the skill rather than its code", () => {
    const csv = caseLogCsv([logged()], TARGETS);
    expect(csv.split("\r\n")[1]).toContain('"Fax"');
  });

  it("leaves the skill blank for an unattributed case instead of writing null", () => {
    expect(caseLogCsv([logged({ skillCode: null })], TARGETS).split("\r\n")[1]).toContain('"","Approved"');
  });

  it("defuses a case number Excel would run as a formula", () => {
    expect(caseLogCsv([logged({ caseNumber: "=cmd|calc" })], TARGETS)).toContain(`"'=cmd|calc"`);
  });

  it("keeps the header a team lead's sheet already expects", () => {
    expect(caseLogCsv([], TARGETS).split("\r\n")[0]).toBe(
      '"Date","PACaseNumber","Skill","Decision","ProviderChecked","MemberChecked","DrugChecked","ActiveApprovalOnFile","CancellationNote","Urgent","QuantityLimitChecked","LoggedAt"',
    );
  });
});

describe("summary csv", () => {
  it("reports the day's hours, rate and target", () => {
    const csv = summaryCsv(
      ["2026-09-08"],
      [block()],
      [logged({ id: "c1" }), logged({ id: "c2", decision: "Pend" })],
      TARGETS,
    );
    // 2 cases, 2 hours -> 1.00/hr, against 2h x 11 = 22 cases.
    expect(csv.split("\r\n")[1]).toBe('"2026-09-08","2","1","0","1","0","2.00","1.00","22"');
  });

  it("breaks out Cancel as its own column, not folded into Pend", () => {
    const csv = summaryCsv(
      ["2026-09-08"],
      [block()],
      [logged({ id: "c1", decision: "Cancel" }), logged({ id: "c2", decision: "Pend" })],
      TARGETS,
    );
    expect(csv.split("\r\n")[0]).toContain('"Pend","Deny","Approved","Cancel"');
    // date, cases, pend=1, deny=0, approved=0, cancel=1
    expect(csv.split("\r\n")[1]).toBe('"2026-09-08","2","1","0","0","1","2.00","1.00","22"');
  });

  it("orders oldest first regardless of the order it is given", () => {
    const csv = summaryCsv(["2026-09-09", "2026-09-08"], [block()], [], TARGETS);
    const dates = csv.split("\r\n").slice(1).map((line) => line.split(",")[0]);
    expect(dates).toEqual(['"2026-09-08"', '"2026-09-09"']);
  });

  it("leaves the rate blank on a day with no hours rather than writing a division", () => {
    expect(summaryCsv(["2026-09-08"], [], [logged()], TARGETS).split("\r\n")[1]).toContain('"0.00","",""');
  });
});

describe("end of day message", () => {
  const day = summarizeDay(
    "2026-09-08",
    [block(), block({ id: "b2", skillCode: "outreach", start: "13:00", end: "14:00" })],
    [logged()],
    TARGETS,
  );

  it("leads with the figures a team lead asks for", () => {
    const body = eodBody(day, "Leou", "Jean", "September 8, 2026");
    expect(body).toContain("Hi Jean,");
    expect(body).toContain("Cases completed: 1");
    expect(body).toContain("Production hours: 3.00");
    expect(body).toContain("Best regards,\nLeou");
  });

  it("breaks the day down by skill, with each skill's own target", () => {
    const body = eodBody(day, "Leou", "Jean", "September 8, 2026");
    expect(body).toContain("Fax: 1 of 22 · 2.00 hrs at 11/hr");
    expect(body).toContain("Outreach: 0 of 10 · 1.00 hrs at 9.5/hr (ramp Week 2)");
  });

  it("says nothing misleading about a day with no hours", () => {
    const empty = summarizeDay("2026-09-08", [], [], TARGETS);
    const body = eodBody(empty, "Leou", "Jean", "September 8, 2026");
    expect(body).toContain("Cases per hour: —");
    expect(body).toContain("Target for the day: —");
  });
});

describe("end of day html", () => {
  const day = summarizeDay(
    "2026-09-08",
    [block(), block({ id: "b2", skillCode: "outreach", start: "13:00", end: "14:00" })],
    [logged()],
    TARGETS,
  );

  it("carries the same figures as the plain-text version", () => {
    const html = eodHtml(day, "Leou", "Jean", "September 8, 2026");
    expect(html).toContain("Hi Jean,");
    expect(html).toContain(">1<");
    expect(html).toContain("3.00");
    expect(html).toContain("Leou");
  });

  it("shows each skill's own status rather than one blended figure", () => {
    const html = eodHtml(day, "Leou", "Jean", "September 8, 2026");
    expect(html).toContain("Fax");
    expect(html).toContain("Outreach");
    expect(html).toContain("RAMP · Week 2");
    expect(html).toContain("short");
  });

  it("escapes a name instead of letting it break the markup", () => {
    const html = eodHtml(day, "Leou <script>alert(1)</script>", "Jean & Co.", "September 8, 2026");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Jean &amp; Co.");
  });

  it("is a full, self-contained document a mail client can render on its own", () => {
    const html = eodHtml(day, "Leou", "Jean", "September 8, 2026");
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });
});

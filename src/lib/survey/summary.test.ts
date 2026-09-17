import { describe, expect, it } from "vitest";
import { filterResponses, npsCategory, summarize, surveyCsv, type SurveyResponseRow } from "./summary";

const response = (over: Partial<SurveyResponseRow> = {}): SurveyResponseRow => ({
  id: over.id ?? "r1",
  respondentName: "Aguilar, Renz",
  respondentEmail: "renz@example.com",
  submittedAt: "2026-09-19T02:00:00.000Z",
  q1Overall: 4,
  q2Ease: 4,
  q3Findability: 4,
  q4Nps: 8,
  q5Feedback: "Search could rank better.",
  ...over,
});

describe("npsCategory", () => {
  it("bands on the standard lines: 9 promotes, 7 is passive, 6 detracts", () => {
    expect([0, 3, 6].map(npsCategory)).toEqual(["detractor", "detractor", "detractor"]);
    expect([7, 8].map(npsCategory)).toEqual(["passive", "passive"]);
    expect([9, 10].map(npsCategory)).toEqual(["promoter", "promoter"]);
  });
});

describe("summarize", () => {
  it("scores NPS as promoters less detractors over everyone, not as an average", () => {
    // Four responses: two promoters, one passive, one detractor.
    // (2 - 1) / 4 = +25. An average of the raw scores would read 7.75.
    const stats = summarize([
      response({ id: "a", q4Nps: 10 }),
      response({ id: "b", q4Nps: 9 }),
      response({ id: "c", q4Nps: 7 }),
      response({ id: "d", q4Nps: 3 }),
    ]);

    expect(stats).toMatchObject({ responses: 4, nps: 25, promoters: 2, passives: 1, detractors: 1 });
  });

  it("goes negative when detractors outnumber promoters", () => {
    expect(summarize([response({ q4Nps: 2 }), response({ id: "b", q4Nps: 10 }), response({ id: "c", q4Nps: 1 })]).nps)
      .toBe(-33);
  });

  it("averages the 1–5 answers", () => {
    const stats = summarize([
      response({ id: "a", q1Overall: 5, q2Ease: 4, q3Findability: 3 }),
      response({ id: "b", q1Overall: 2, q2Ease: 2, q3Findability: 2 }),
    ]);

    expect(stats).toMatchObject({ avgOverall: 3.5, avgEase: 3, avgFindability: 2.5 });
  });

  it("reads nothing measured as nothing, rather than as zero", () => {
    // A zero NPS and a 0.0 average are real answers; an empty view has none.
    expect(summarize([])).toMatchObject({
      responses: 0,
      avgOverall: null,
      avgEase: null,
      nps: null,
      promoters: 0,
      detractors: 0,
    });
  });
});

describe("filterResponses", () => {
  const now = new Date("2026-09-20T00:00:00.000Z");
  const rows = [
    response({ id: "new", submittedAt: "2026-09-19T00:00:00.000Z", q5Feedback: "Dark mode please" }),
    response({
      id: "mid",
      submittedAt: "2026-09-05T00:00:00.000Z",
      respondentName: "Santillan, Bea",
      respondentEmail: "bea@example.com",
    }),
    response({ id: "old", submittedAt: "2026-07-01T00:00:00.000Z", q5Feedback: "Reports load slowly" }),
  ];

  it("returns everything newest first when nothing is filtered", () => {
    expect(filterResponses(rows, { search: "", withinDays: null }, now).map((r) => r.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("counts the date window back from now, not from the newest response", () => {
    expect(filterResponses(rows, { search: "", withinDays: 7 }, now).map((r) => r.id)).toEqual(["new"]);
    expect(filterResponses(rows, { search: "", withinDays: 30 }, now).map((r) => r.id)).toEqual(["new", "mid"]);
  });

  it("searches the name, the email and the feedback", () => {
    expect(filterResponses(rows, { search: "santillan", withinDays: null }, now).map((r) => r.id)).toEqual(["mid"]);
    expect(filterResponses(rows, { search: "renz@", withinDays: null }, now).map((r) => r.id)).toEqual([
      "new",
      "old",
    ]);
    expect(filterResponses(rows, { search: "slowly", withinDays: null }, now).map((r) => r.id)).toEqual(["old"]);
  });

  it("matches without regard to case, and ignores surrounding space", () => {
    expect(filterResponses(rows, { search: "  DARK Mode ", withinDays: null }, now).map((r) => r.id)).toEqual(["new"]);
  });

  it("combines the search and the window rather than choosing between them", () => {
    expect(filterResponses(rows, { search: "renz@", withinDays: 7 }, now).map((r) => r.id)).toEqual(["new"]);
  });

  it("counts a response on the cutoff itself as inside the window", () => {
    // "new" is exactly one day old. A window of a day holds it; anything
    // narrower does not, and an off-by-one here silently hides the newest
    // response from the view a leader checks first.
    expect(filterResponses(rows, { search: "", withinDays: 1 }, now).map((r) => r.id)).toEqual(["new"]);
    const later = new Date("2026-09-20T00:00:01.000Z");
    expect(filterResponses(rows, { search: "", withinDays: 1 }, later)).toEqual([]);
  });
});

describe("surveyCsv", () => {
  it("keeps typed feedback as text when it starts like a spreadsheet formula", () => {
    // Free text goes straight into a file someone opens in Excel. Without
    // the guard, "=SUM(...)" in the feedback column is a live formula.
    const csv = surveyCsv([response({ q5Feedback: "=SUM(A1:A9) should be the total" })]);

    expect(csv).toContain('" =SUM(A1:A9) should be the total"');
  });

  it("doubles a quote in the feedback rather than ending the cell early", () => {
    expect(surveyCsv([response({ q5Feedback: 'It said "no results" every time' })])).toContain(
      '"It said ""no results"" every time"',
    );
  });

  it("leads with a header row and carries the NPS band beside the score", () => {
    const lines = surveyCsv([response({ q4Nps: 10 })]).split("\r\n");

    expect(lines[0]).toBe(
      '"Respondent","Email","Submitted","Overall","Ease of use","Finding info","NPS","NPS band","Feedback"',
    );
    expect(lines[1]).toContain('"10","promoter"');
  });

  it("exports a header and nothing else for an empty view", () => {
    expect(surveyCsv([]).split("\r\n").filter(Boolean)).toHaveLength(1);
  });
});

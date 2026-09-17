import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ROSTER_COLUMNS, type RosterRow } from "./columns";
import { RosterTable } from "./roster-table";

// The row links to an employee's record; the test only needs the markup.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));

const cells = (over: Record<string, { value: number | null; status: string | null }> = {}) => {
  const out: RosterRow["cells"] = {};
  for (const column of ROSTER_COLUMNS) out[column.code] = { value: null, status: null };
  return { ...out, ...over };
};

const agent = (over: Partial<RosterRow> = {}): RosterRow => ({
  employeeId: "emp-1",
  name: "Aguilar, Renz",
  eid: "001895123",
  below: 0,
  phoneHours: 32.5,
  nonPhoneHours: 7.5,
  hoursNote: "PartD Phones: 32.5h (phone) · Fax: 7.5h (non-phone)",
  cells: cells(),
  ...over,
});

const render = (rows: RosterRow[]) =>
  renderToStaticMarkup(createElement(RosterTable, { rows, initialSort: "worst" }));

describe("the roster table", () => {
  it("shows every column the brief names, in order", () => {
    const html = render([agent()]);
    // The header cells only — the Sort control above the table is uppercase too.
    const headers = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].trim());

    expect(headers).toEqual([
      "Agent",
      "Below",
      "PAR",
      "Case Rate",
      "AHT",
      "CPH",
      "Quality",
      "NPS",
      "Attendance",
      "MBO",
    ]);
    expect(headers).toHaveLength(2 + ROSTER_COLUMNS.length);
  });

  it("shows PAR and MBO as their own figures, not as a verdict", () => {
    const html = render([
      agent({
        cells: cells({
          PRODUCTION_RATE: { value: 3.42, status: "PASS" },
          MBO: { value: 100, status: "PASS" },
        }),
      }),
    ]);

    // "Fail" alone cannot tell a leader whether someone missed by 0.01 or by
    // a point, and that is the difference between a word and a plan.
    expect(html).toContain("3.42");
    expect(html).toContain("100%");
    expect(html).not.toContain(">Pass<");
    expect(html).not.toContain(">Fail<");
  });

  it("keeps the gate's verdict as the colour on a miss", () => {
    const html = render([
      agent({
        cells: cells({
          PRODUCTION_RATE: { value: 2.98, status: "FAIL" },
          MBO: { value: 66.7, status: "FAIL" },
        }),
        below: 2,
      }),
    ]);

    expect(html).toContain("2.98");
    expect(html).toContain("67%");
    expect(html).toContain("text-fail");
  });

  it("shades a row only once an agent is below target on four or more measures", () => {
    const three = render([agent({ below: 3 })]);
    const four = render([agent({ below: 4 })]);

    expect(three).not.toContain("bg-fail-bg");
    expect(four).toContain("bg-fail-bg");
  });

  it("carries the hours sub-line, with the skills behind it available on hover", () => {
    const html = render([agent()]);

    expect(html).toContain("Phone Hours:");
    expect(html).toContain("32.5h");
    expect(html).toContain("Non-Phone Hours:");
    expect(html).toContain("7.5h");
    expect(html).toContain("PartD Phones: 32.5h (phone)");
  });

  it("says nothing was worked rather than printing a zero split", () => {
    const html = render([agent({ phoneHours: null, nonPhoneHours: null, hoursNote: null })]);

    expect(html).toContain("No productive hours this period");
    expect(html).not.toContain("Phone Hours:");
  });

  it("reads an unmeasured KPI as a dash, so the agent still gets a row", () => {
    const html = render([agent({ cells: cells() })]);

    expect(html).toContain("Aguilar, Renz");
    expect(html).toContain("—");
  });

  it("orders worst first, then alphabetically among equals", () => {
    const html = render([
      agent({ employeeId: "a", name: "Zulueta, Ana", below: 1 }),
      agent({ employeeId: "b", name: "Bautista, Kim", below: 5 }),
      agent({ employeeId: "c", name: "Abad, Leo", below: 1 }),
    ]);
    const order = [...html.matchAll(/>([A-Z][a-z]+, [A-Z][a-z]+)</g)].map((m) => m[1]);

    expect(order).toEqual(["Bautista, Kim", "Abad, Leo", "Zulueta, Ana"]);
  });

  it("links each agent to their own record", () => {
    expect(render([agent()])).toContain('href="/employees/emp-1"');
  });
});

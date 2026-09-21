import { describe, expect, it } from "vitest";
import { groupCategories, type PlanCategory } from "./plan-categories";

const row = (id: string, label: string, groupLabel: string): PlanCategory => ({ id, label, groupLabel });

describe("groupCategories", () => {
  it("folds a run of rows under the heading they share", () => {
    expect(
      groupCategories([
        row("1", "Comms Training", "With the agent"),
        row("2", "Peer Feedback", "With the agent"),
        row("3", "Raise HD Ticket", "Raised elsewhere"),
      ]),
    ).toEqual([
      ["With the agent", [row("1", "Comms Training", "With the agent"), row("2", "Peer Feedback", "With the agent")]],
      ["Raised elsewhere", [row("3", "Raise HD Ticket", "Raised elsewhere")]],
    ]);
  });

  it("keeps the order it was given rather than the headings' own", () => {
    // The order is the table's to decide through sort_order. Grouping by key
    // would re-order the list into whatever a map happened to hold, and the
    // headings would stop matching what an administrator arranged.
    const groups = groupCategories([
      row("1", "Raise HD Ticket", "Raised elsewhere"),
      row("2", "Comms Training", "With the agent"),
    ]);

    expect(groups.map(([heading]) => heading)).toEqual(["Raised elsewhere", "With the agent"]);
  });

  it("leaves a heading that recurs as two runs, because that is what the rows say", () => {
    const groups = groupCategories([
      row("1", "A", "First"),
      row("2", "B", "Second"),
      row("3", "C", "First"),
    ]);

    expect(groups.map(([heading, options]) => [heading, options.length])).toEqual([
      ["First", 1],
      ["Second", 1],
      ["First", 1],
    ]);
  });

  it("gives an ungrouped row its own run, so it is still selectable", () => {
    // "Other" carries no heading, and a category added later without one
    // must not vanish from the dropdown.
    expect(groupCategories([row("1", "Other", "")])).toEqual([["", [row("1", "Other", "")]]]);
  });

  it("has nothing to group when the list could not be read", () => {
    // The table arrives with migration 0060 and the page deploys first; the
    // read answers an empty list rather than failing.
    expect(groupCategories([])).toEqual([]);
  });
});

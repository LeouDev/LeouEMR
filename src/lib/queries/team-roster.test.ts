import { describe, expect, it } from "vitest";
import { groupIntoLeads, UNASSIGNED } from "./team-roster";

const row = (
  employeeId: string,
  supervisor: string | null,
  manager: string | null = "Cruz, Dana",
  site: string | null = "CEBU",
) => ({ employeeId, supervisor, manager, site });

describe("groupIntoLeads", () => {
  it("gives one row per lead with their whole roster, alphabetically", () => {
    const leads = groupIntoLeads([
      row("e1", "Reyes, Kristian"),
      row("e2", "Aguilar, Renz"),
      row("e3", "Reyes, Kristian"),
    ]);

    expect(leads.map((l) => l.name)).toEqual(["Aguilar, Renz", "Reyes, Kristian"]);
    expect(leads[1].memberIds).toEqual(["e1", "e3"]);
  });

  it("keeps a lead whose people span two sites as one team, labelled by the majority", () => {
    // A lead really can have people at two sites; they are still one team,
    // and one mis-keyed masterlist row must not relabel the whole thing.
    const leads = groupIntoLeads([
      row("e1", "Reyes, Kristian", "Cruz, Dana", "CEBU"),
      row("e2", "Reyes, Kristian", "Cruz, Dana", "CEBU"),
      row("e3", "Reyes, Kristian", "Cruz, Dana", "QC"),
    ]);

    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ site: "CEBU", memberIds: ["e1", "e2", "e3"] });
  });

  it("breaks a tie on the label alphabetically, so the answer does not depend on row order", () => {
    const forwards = groupIntoLeads([
      row("e1", "Reyes, Kristian", "Cruz, Dana", "QC"),
      row("e2", "Reyes, Kristian", "Cruz, Dana", "CEBU"),
    ]);
    const backwards = groupIntoLeads([
      row("e2", "Reyes, Kristian", "Cruz, Dana", "CEBU"),
      row("e1", "Reyes, Kristian", "Cruz, Dana", "QC"),
    ]);

    expect(forwards[0].site).toBe("CEBU");
    expect(backwards[0].site).toBe("CEBU");
  });

  it("names the majority manager, not whichever row came first", () => {
    const leads = groupIntoLeads([
      row("e1", "Reyes, Kristian", "Shah, Ravi"),
      row("e2", "Reyes, Kristian", "Cruz, Dana"),
      row("e3", "Reyes, Kristian", "Cruz, Dana"),
    ]);

    expect(leads[0].manager).toBe("Cruz, Dana");
  });

  it("gathers people with no lead under one heading rather than dropping them", () => {
    const leads = groupIntoLeads([row("e1", null), row("e2", "")]);

    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: UNASSIGNED, memberIds: ["e1", "e2"] });
  });

  it("reads a lead with no site or manager on record as absent, not as a blank label", () => {
    const leads = groupIntoLeads([row("e1", "Reyes, Kristian", null, null)]);

    expect(leads[0]).toMatchObject({ site: null, manager: null });
  });

  it("has no leads at all for an empty roster", () => {
    expect(groupIntoLeads([])).toEqual([]);
  });
});

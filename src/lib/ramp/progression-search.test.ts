import { describe, expect, it } from "vitest";
import { filterTeams } from "./progression-search";

const teams = [
  {
    supervisor: "Archiene Ross Calderon Herbias",
    roster: [
      { employeeId: "a1", employeeName: "Advincula,Ronn Rafael", eid: "900292164" },
      { employeeId: "a2", employeeName: "Alba,Dorellyn", eid: "900292132" },
    ],
  },
  {
    supervisor: "Dacanay,Beulah",
    roster: [{ employeeId: "d1", employeeName: "Aniban,Brandon Saludaga", eid: "002233004" }],
  },
];

describe("filterTeams", () => {
  it("lists every team whole when nothing is typed", () => {
    expect(filterTeams(teams, "  ")).toEqual([
      { team: teams[0], agentIds: null },
      { team: teams[1], agentIds: null },
    ]);
  });

  it("finds a supervisor by any part of the name, whole team", () => {
    const [only] = filterTeams(teams, "herbias");
    expect(only.team.supervisor).toBe("Archiene Ross Calderon Herbias");
    expect(only.agentIds).toBeNull();
    expect(filterTeams(teams, "herbias")).toHaveLength(1);
  });

  it("finds an agent by name or employee ID, with only the matching agents", () => {
    const [byName] = filterTeams(teams, "alba");
    expect(byName.team.supervisor).toBe("Archiene Ross Calderon Herbias");
    expect([...byName.agentIds!]).toEqual(["a2"]);

    const [byEid] = filterTeams(teams, "002233004");
    expect(byEid.team.supervisor).toBe("Dacanay,Beulah");
    expect([...byEid.agentIds!]).toEqual(["d1"]);
  });

  it("ignores case, accents and the punctuation names carry", () => {
    expect(filterTeams(teams, "DACANAY BEULAH")).toHaveLength(1);
    expect(filterTeams(teams, "Aniban Brandon")).toHaveLength(1);
    expect(filterTeams(teams, "Ádvincula")).toHaveLength(1);
  });

  it("requires every term, and lists nothing when none fits", () => {
    expect(filterTeams(teams, "alba herbias")).toHaveLength(0); // a supervisor term and an agent term never both match one name
    expect(filterTeams(teams, "ronn rafael")).toHaveLength(1);
    expect(filterTeams(teams, "nobody")).toHaveLength(0);
  });
});

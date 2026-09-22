import { describe, expect, it } from "vitest";
import { completionByLeader } from "./completion";

describe("completionByLeader", () => {
  it("sums each leader's required and completed audits and gives the share", () => {
    const rows = completionByLeader([
      { supervisorName: "Dacanay,Beulah", standing: "active", required: 2, completed: 2 },
      { supervisorName: "Dacanay,Beulah", standing: "active", required: 2, completed: 1 },
      { supervisorName: "Aniban, Brandon", standing: "active", required: 2, completed: 0 },
    ]);
    expect(rows).toEqual([
      { leader: "Aniban, Brandon", activeAgents: 1, required: 2, completed: 0, completionPct: 0 },
      { leader: "Dacanay,Beulah", activeAgents: 2, required: 4, completed: 3, completionPct: 75 },
    ]);
  });

  it("does not count an agent who owed nothing as active, but keeps any audit they got", () => {
    const [row] = completionByLeader([
      { supervisorName: "Lea", standing: "active", required: 2, completed: 2 },
      { supervisorName: "Lea", standing: "on_leave", required: 0, completed: 1 },
    ]);
    expect(row).toMatchObject({ activeAgents: 1, required: 2, completed: 3, completionPct: 150 });
  });

  it("leaves out a leader whose team owed nothing that week", () => {
    expect(
      completionByLeader([{ supervisorName: "Lea", standing: "separated", required: 0, completed: 0 }]),
    ).toEqual([]);
  });

  it("files an agent with no team leader under Unassigned", () => {
    const [row] = completionByLeader([{ supervisorName: null, standing: "active", required: 2, completed: 1 }]);
    expect(row.leader).toBe("Unassigned");
  });
});

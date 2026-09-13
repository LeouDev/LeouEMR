import { describe, expect, it } from "vitest";
import { countMatches, matchAgents, type AgentOption } from "./agent-search";

const roster: AgentOption[] = [
  { id: "1", name: "Abad, Maria", eid: "001111111", supervisorName: "Cruz, Ben" },
  { id: "2", name: "Cruz, Ana", eid: "002222222", supervisorName: "Tuting, Lea" },
  { id: "3", name: "Dela Cruz, José", eid: "003333333", supervisorName: "Cruz, Ben" },
  { id: "4", name: "Santos, Rey", eid: "004444444", supervisorName: null },
];
const names = (rows: AgentOption[]) => rows.map((r) => r.name);

describe("matchAgents", () => {
  it("matches on the name, the employee ID and the team leader", () => {
    expect(names(matchAgents(roster, "santos"))).toEqual(["Santos, Rey"]);
    expect(names(matchAgents(roster, "0033"))).toEqual(["Dela Cruz, José"]);
    expect(names(matchAgents(roster, "tuting"))).toEqual(["Cruz, Ana"]);
  });

  it("folds case, accents and punctuation, and needs every term", () => {
    expect(names(matchAgents(roster, "JOSE"))).toEqual(["Dela Cruz, José"]);
    expect(names(matchAgents(roster, "cruz jose"))).toEqual(["Dela Cruz, José"]);
    expect(names(matchAgents(roster, "cruz ben"))).toEqual(["Abad, Maria", "Dela Cruz, José"]);
    expect(matchAgents(roster, "cruz nobody")).toEqual([]);
  });

  it("lists names that begin with the query before the rest", () => {
    expect(names(matchAgents(roster, "cru"))).toEqual(["Cruz, Ana", "Abad, Maria", "Dela Cruz, José"]);
  });

  it("shows the first few for an empty query and caps the list", () => {
    expect(names(matchAgents(roster, "  "))).toEqual(names(roster));
    expect(names(matchAgents(roster, "", 2))).toEqual(["Abad, Maria", "Cruz, Ana"]);
    expect(names(matchAgents(roster, "cruz", 1))).toEqual(["Cruz, Ana"]);
    expect(countMatches(roster, "cruz")).toBe(3);
  });
});

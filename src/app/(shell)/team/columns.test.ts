import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROSTER_COLUMNS, SHADE_AT } from "./columns";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

/**
 * The arrangement this module exists for.
 *
 * `ROSTER_COLUMNS` started out exported from roster-table.tsx, a client
 * component, and the server page iterated it. That typechecks and builds,
 * then throws "ROSTER_COLUMNS is not iterable" on every request, because a
 * value imported from a client module into a server one arrives as a client
 * reference proxy. The dashboard had already been taken down once the same
 * way (see dashboard/kpi-groups.ts). These assertions fail if anyone moves
 * the shared values back across that boundary.
 */
describe("the roster's shared shape", () => {
  it("lives in a module with no 'use client' directive", () => {
    // The directive has to be the file's first statement to have any effect,
    // so that is what is checked — the prose above it says the words too.
    expect(read("./columns.ts")).not.toMatch(/^\s*(["'])use client\1/);
  });

  it("is real data on this side of the boundary, not a reference proxy", () => {
    expect(Array.isArray(ROSTER_COLUMNS)).toBe(true);
    expect([...ROSTER_COLUMNS]).toHaveLength(8);
    expect(typeof SHADE_AT).toBe("number");
  });

  it("is not exported from the client component, which the server page reads", () => {
    const client = read("./roster-table.tsx");
    expect(client).toContain('"use client"');
    // Only the component crosses back out; every shared value comes from ./columns.
    expect(client).not.toMatch(/export const (ROSTER_COLUMNS|SHADE_AT)\b/);
  });

  it("is what the server page imports from, so the page never touches the client module's values", () => {
    const page = read("./page.tsx");
    expect(page).toMatch(/import \{[^}]*ROSTER_COLUMNS[^}]*\} from "\.\/columns"/);
    // The page may import the component itself, but no value from that file.
    expect(page).toMatch(/import \{ RosterTable \} from "\.\/roster-table"/);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards, not behaviour tests.
 *
 * `cachedRead` hands back the bare read outside the Next.js server (see
 * lib/cache.ts), which is exactly where the test suite runs — so a test
 * cannot observe whether these reads are cached by calling them. What it
 * can do is hold the shape in place.
 *
 * Both reads here are an agent's whole history: every weekly result, every
 * KPI, and every daily skill fact under them. The Development Hub roster
 * made opening an agent a click rather than a page visit, and uncached that
 * meant the same rows leaving the database again on every open, for every
 * leader, all month. Putting them back outside a cached read would not fail
 * anything visibly — it would just quietly cost egress again.
 */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start, `${declaration} not found`).toBeGreaterThan(-1);
  const rest = source.slice(start + declaration.length);
  const end = rest.search(/\n(?:\/\*\*|export )/);
  return end === -1 ? rest : rest.slice(0, end);
}

const performance = readFileSync(join(process.cwd(), "src/lib/queries/performance.ts"), "utf8");
const skillBreakdown = readFileSync(join(process.cwd(), "src/lib/queries/skill-breakdown.ts"), "utf8");

describe("the employee matrix read", () => {
  const body = bodyOf(performance, "export async function getEmployeeMatrix(");

  it("goes through a cached read", () => {
    expect(performance).toMatch(/const readMatrixRows = cachedRead\(\s*"employee-matrix"/);
    expect(body).toContain("readMatrixRows(employeeId)");
  });

  it("is invalidated by everything that can change what it holds", () => {
    const tags = performance.match(/"employee-matrix",\s*\[([^\]]*)\]/)?.[1] ?? "";
    for (const tag of ["imports", "reference", "ews", "issues"]) {
      expect(tags).toContain(`CACHE_TAG.${tag}`);
    }
  });

  it("queries nothing itself but the employee row", () => {
    // The row is one lookup by primary key, and it stays outside the cache
    // so its timestamps do not go through JSON and come back as strings.
    expect([...body.matchAll(/\.from\((\w+)\)/g)].map(([, table]) => table)).toEqual(["employees"]);
  });

  it("names the columns it wants from the issue history", () => {
    // A bare select() would carry created_at — a Date — into a cache that
    // serialises what it stores, handing the next reader a string. Only the
    // cached read is held to this; the uncached per-item read elsewhere in
    // the file can select what it likes.
    const cached = bodyOf(performance, "const readMatrixRows = cachedRead(");
    expect(cached).not.toMatch(/\.select\(\)\s*\.from\(weeklyIssueHistory\)/);
    expect(cached).toMatch(/consecutiveCountAfter: weeklyIssueHistory\.consecutiveCountAfter/);
  });
});

describe("the skill breakdown read", () => {
  const body = bodyOf(skillBreakdown, "export async function getEmployeeSkillBreakdown(");

  it("goes through a cached read, keyed on the range it covers", () => {
    expect(skillBreakdown).toMatch(/const readSkillFacts = cachedRead\(\s*"employee-skill-facts"/);
    expect(body).toContain("readSkillFacts(employeeId, rangeStart, rangeEnd)");
  });

  it("does not read the facts table directly any more", () => {
    expect(body).not.toContain(".from(skillFacts)");
  });
});

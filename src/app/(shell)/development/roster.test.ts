import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A static guard, not a render test.
 *
 * The roster is a client component that needs a handful of things the query
 * modules also export. A TYPE from one is free — types are erased — but a
 * VALUE makes the bundler pull that module into the browser, and with it
 * the database client, the cache and Node built-ins that do not exist
 * there. That is not a subtle failure: the production build stops with
 * "Can't resolve 'fs'". It stopped this one, which is why this test is
 * here.
 */
const source = readFileSync(join(process.cwd(), "src/app/(shell)/development/roster.tsx"), "utf8");

describe("the development roster's imports", () => {
  it("never takes a value from a query module", () => {
    const valueImports = [...source.matchAll(/^import\s+(?!type\b)([^;]*?)from\s+"([^"]+)"/gm)]
      .filter(([, , from]) => from.startsWith("@/lib/queries/"))
      // `import { type X }` inside the braces is also erased.
      .filter(([, clause]) => clause.replace(/\btype\s+\w+/g, "").match(/[A-Za-z_$][\w$]*/));

    expect(valueImports.map(([, , from]) => from)).toEqual([]);
  });

  it("still takes its types from there, which is the point of the distinction", () => {
    expect(source).toMatch(/import type \{[^}]*RosterManager[^}]*\} from "@\/lib\/queries\/development"/);
  });

  it("gets the sustained-weeks constant from the module that exists to be client-safe", () => {
    expect(source).toContain('from "@/lib/development/sustained"');
  });
});

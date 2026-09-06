import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";

const file = process.argv[2];
const statements = readFileSync(file, "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)*$/.test(s));

for (const [i, statement] of statements.entries()) {
  const head = statement.split("\n").filter((l) => !l.trim().startsWith("--"))[0]?.slice(0, 70);
  try {
    await db.execute(sql.raw(statement));
    console.log(`  ${i + 1}/${statements.length} ok   ${head}`);
  } catch (e) {
    console.error(`  ${i + 1}/${statements.length} FAIL ${head}\n     ${(e as Error).message}`);
    process.exit(1);
  }
}
console.log("applied");
process.exit(0);

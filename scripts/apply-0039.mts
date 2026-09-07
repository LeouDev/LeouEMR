/**
 * Applies migration 0039 and catches drizzle's tracker up, without the
 * Supabase dashboard.
 *
 * Same three steps as drizzle/APPLY_0039_AND_RECONCILE.sql, run through the
 * connection in .env.local instead of the SQL editor. Written because the
 * dashboard was down and the constraint is the one thing standing between
 * this database and another batch of rows with no import behind them.
 *
 * Idempotent and transactional: the inserts are guarded, SET NOT NULL on an
 * already-constrained column is a no-op, and a failure anywhere rolls the
 * whole thing back rather than leaving the tracker ahead of the schema.
 *
 *   npm run migrate:0039          # report what would change
 *   npm run migrate:0039 -- --apply
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";

const apply = process.argv.includes("--apply");

const TABLES = [
  "weekly_metric_results",
  "metric_facts",
  "skill_facts",
  "quality_facts",
  "nps_facts",
  "employee_assignments",
] as const;

/** hash → the migration file it stands for; drizzle keys on the file's sha256. */
const UNRECORDED: Array<[string, number, string]> = [
  ["5063fbe720dcc857734e116dfcd7d31bfd74bbed0761a9bb22deb3a5742edd69", 1788708114857, "0034_employee_assignments"],
  ["f8360d82ac1e110843790c3a86db3161e935771c68ac843501a20d39e301e5bf", 1788708115857, "0035_pto_code_sequence"],
  ["6b8fe974e1a756233651c950a758e7ffd2ac523085f8cc20b356fd688dd52626", 1788708116857, "0036_scoping_indexes"],
  ["faf7d2cc29072e7e9cb8d8ba77b771251d76428aa498bf13af6dbc9a02fe8bc6", 1788711077262, "0037_time_motion_studies"],
  ["35d6b9debf46e9639c5e296c3ba4a349003085d6aab039dd1a7a20a3e761893e", 1788720995488, "0038_ramp_schedules"],
  ["c7fe6fc5250569d81fb8635ee32ac779ea6a9e7e0ad12c8e5287327628fe6fc5", 1788784213106, "0039_require_source_import"],
];

const rows = async (s: ReturnType<typeof sql>) => {
  const r = await db.execute(s as never);
  return ((r as never as { rows?: unknown[] }).rows ?? (r as never as unknown[])) as Record<string, unknown>[];
};

const report = async (label: string) => {
  const [{ n }] = (await rows(sql`select count(*)::int n from drizzle.__drizzle_migrations`)) as [{ n: number }];
  const cols = await rows(sql`select table_name, is_nullable from information_schema.columns
    where column_name = 'source_import_id' and table_schema = 'public' order by table_name`);
  const nullable = cols.filter((c) => c.is_nullable === "YES").map((c) => c.table_name);
  console.log(`${label}: ${n} migrations recorded; ${nullable.length} of ${cols.length} columns still nullable`);
  if (nullable.length > 0) console.log(`  nullable: ${nullable.join(", ")}`);
  return { n, nullable: nullable.length };
};

console.log(`mode: ${apply ? "APPLY" : "dry run"}\n`);
const before = await report("before");

// Nothing can be constrained while a null is present, so say so plainly
// rather than letting Postgres fail halfway through the transaction.
let blocked = false;
for (const table of TABLES) {
  const [{ n }] = (await rows(
    sql`select count(*)::int n from ${sql.identifier(table)} where source_import_id is null`,
  )) as [{ n: number }];
  if (n > 0) {
    console.log(`  BLOCKED  ${table} has ${n} rows with no source_import_id`);
    blocked = true;
  }
}
if (blocked) {
  console.log("\nRun `npm run purge:unsourced -- --apply` first.");
  process.exit(1);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply.");
  process.exit(0);
}

await db.transaction(async (tx) => {
  for (const [hash, when] of UNRECORDED) {
    await tx.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at)
          values (${hash}, ${when}) on conflict do nothing`,
    );
  }
  for (const table of TABLES) {
    await tx.execute(sql`alter table ${sql.identifier(table)} alter column source_import_id set not null`);
  }
});

console.log();
const after = await report("after ");
const ok = after.n === 39 && after.nullable === 0;
console.log(ok ? "\nDone — 39 recorded, every column constrained." : "\nUnexpected final state; check the numbers above.");
process.exit(ok ? 0 : 1);

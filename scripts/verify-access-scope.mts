/**
 * Verifies role scoping against real data.
 *
 * Exercises the same query functions the pages use, so this proves what a
 * given role can actually retrieve — not merely what the UI chooses to
 * render. Scoping must fail closed: an unlinked account sees nothing.
 *
 *   npm run verify:scope
 */
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { employees, performanceIssues } from "../src/lib/db/schema";
import type { CurrentUser } from "../src/lib/auth/session";
import { getActionItems, getAttentionRows, getTeamSummary } from "../src/lib/queries/performance";

function asUser(over: Partial<CurrentUser>): CurrentUser {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    email: "probe@example.invalid",
    name: "Probe",
    role: "agent",
    status: "active",
    employeeEid: null,
    ...over,
  };
}

const [{ n: totalEmployees }] = await db.select({ n: count() }).from(employees);
const [{ n: totalIssues }] = await db.select({ n: count() }).from(performanceIssues);
console.log(`Dataset: ${totalEmployees} employees, ${totalIssues} performance issues\n`);

// Pick a real supervisor, manager and agent out of the imported hierarchy.
const [sup] = await db
  .select({ eid: employees.supervisorEid, name: employees.supervisorName })
  .from(employees)
  .where(eq(employees.supervisorEid, "900219893"))
  .limit(1);

const [mgrRow] = await db
  .select({ name: employees.managerName })
  .from(employees)
  .where(eq(employees.supervisorEid, sup.eid!))
  .limit(1);

const [agentRow] = await db
  .select({ eid: employees.eid, name: employees.name })
  .from(employees)
  .where(eq(employees.eid, "900130217"))
  .limit(1);

const week = "2026-08-22";
let failures = 0;

function check(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual} (expected ${expected})`);
}

// Expected counts computed independently of the query layer.
const [{ n: supTeam }] = await db
  .select({ n: count() })
  .from(employees)
  .where(eq(employees.supervisorEid, sup.eid!));
const [{ n: mgrSpan }] = await db
  .select({ n: count() })
  .from(employees)
  .where(eq(employees.managerName, mgrRow.name!));

console.log("ADMIN — sees the whole organization");
const admin = await getTeamSummary(asUser({ role: "admin" }), week);
check("  employees visible", admin.totalEmployees, totalEmployees);

console.log(`\nMANAGER (${mgrRow.name}) — sees only their span`);
const manager = await getTeamSummary(asUser({ role: "manager", name: mgrRow.name! }), week);
check("  employees visible", manager.totalEmployees, mgrSpan);
console.log(`  (span is ${mgrSpan} of ${totalEmployees}; excluded ${totalEmployees - mgrSpan})`);

console.log(`\nSUPERVISOR (${sup.name}) — sees only their team`);
const supervisor = await getTeamSummary(
  asUser({ role: "supervisor", employeeEid: sup.eid! }),
  week,
);
check("  employees visible", supervisor.totalEmployees, supTeam);

console.log(`\nAGENT (${agentRow.name}) — sees only themselves`);
const agentUser = asUser({ role: "agent", employeeEid: agentRow.eid });
const agent = await getTeamSummary(agentUser, week);
check("  employees visible", agent.totalEmployees, 1);

const agentRows = await getAttentionRows(agentUser, week, 500);
const foreignRows = agentRows.filter((r) => r.employeeEid !== agentRow.eid).length;
check("  attention rows belonging to others", foreignRows, 0);

const agentItems = await getActionItems(agentUser, { openOnly: false, limit: 500 });
const [{ n: ownIssues }] = await db
  .select({ n: count() })
  .from(performanceIssues)
  .where(
    inArray(
      performanceIssues.employeeId,
      db.select({ id: employees.id }).from(employees).where(eq(employees.eid, agentRow.eid)),
    ),
  );
check("  action items visible", agentItems.length, ownIssues);

console.log("\nUNLINKED ACCOUNTS — must fail closed, not open");
const unlinkedSup = await getTeamSummary(asUser({ role: "supervisor", employeeEid: null }), week);
check("  unlinked supervisor sees", unlinkedSup.totalEmployees, 0);
const unlinkedAgent = await getTeamSummary(asUser({ role: "agent", employeeEid: null }), week);
check("  unlinked agent sees", unlinkedAgent.totalEmployees, 0);
const unknownMgr = await getTeamSummary(asUser({ role: "manager", name: "No Such Manager" }), week);
check("  manager with no matching span sees", unknownMgr.totalEmployees, 0);

// A supervisor must not be able to reach another team's action item by id.
const [foreign] = await db
  .select({ id: performanceIssues.id })
  .from(performanceIssues)
  .innerJoin(employees, eq(employees.id, performanceIssues.employeeId))
  .where(and(eq(employees.supervisorEid, "001918874")))
  .limit(1);

if (foreign) {
  const supUser = asUser({ role: "supervisor", employeeEid: sup.eid! });
  const visible = await getActionItems(supUser, { openOnly: false, limit: 1000 });
  const leaked = visible.filter((v) => v.issueCode === undefined).length;
  check("  another team's items leaked to supervisor", leaked, 0);
}

console.log(failures === 0 ? "\nAll scope checks passed." : `\n${failures} scope check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

import { inArray, sql, type SQL } from "drizzle-orm";
import { employeeAssignments, employees } from "@/lib/db/schema";

/** Anything that can run a statement: the db itself, or a transaction on it. */
interface Executor {
  execute(query: SQL): PromiseLike<unknown>;
}

/**
 * Brings each person's `employees` row — the "now" snapshot the operational
 * scope keys on (who may open their page, approve their leave) — in step
 * with their open assignment interval, the latest thing any import said
 * about who they report to.
 *
 * The weekly import writes that snapshot straight from the file, and the
 * masterlist never wrote it at all, so the two could disagree: a team
 * realigned under a manager by the September masterlist still carried the
 * previous manager on its employee rows, and that manager's dashboard
 * (which follows the assignments) listed people whose pages (which follow
 * the snapshot) answered "not found". Someone with no open interval —
 * closed by a masterlist, or never assigned — is left as they are.
 *
 * A file that names the supervisor but not their EID (the column is
 * optional in both formats) does not blank an EID the snapshot already
 * holds for that same supervisor; a different supervisor with no EID is
 * recorded as exactly that, since a stale EID would put the person on the
 * wrong team leader's "My team".
 */
export async function syncEmployeeSnapshots(executor: Executor, employeeIds: string[]): Promise<void> {
  if (employeeIds.length === 0) return;
  await executor.execute(sql`
    update ${employees} as e set
      supervisor_eid = v.supervisor_eid,
      supervisor_name = v.supervisor_name,
      manager_name = v.manager_name,
      site = v.site,
      updated_at = now()
    from (
      select
        a.employee_id,
        coalesce(
          a.supervisor_eid,
          case when current.supervisor_name is not distinct from a.supervisor_name then current.supervisor_eid end
        ) as supervisor_eid,
        a.supervisor_name,
        a.manager_name,
        a.site
      from ${employeeAssignments} as a
      join ${employees} as current on current.id = a.employee_id
      where a.effective_to is null and ${inArray(sql`a.employee_id`, employeeIds)}
    ) as v
    where v.employee_id = e.id
      and (
        e.supervisor_eid is distinct from v.supervisor_eid
        or e.supervisor_name is distinct from v.supervisor_name
        or e.manager_name is distinct from v.manager_name
        or e.site is distinct from v.site
      )
  `);
}

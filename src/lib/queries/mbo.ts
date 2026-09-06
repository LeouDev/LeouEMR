import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assignmentAt, reportingScopeIds, supervisorOfRecord } from "./org-history";
import { employeeAssignments, employees } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { MBO_GATES } from "@/lib/import-pipeline/par-scoring";
import { getPeriodMetrics } from "./period-metrics";

import type { Period } from "./period";

export interface MboRow {
  employeeId: string;
  eid: string;
  name: string;
  supervisorName: string | null;
  /** Share of applicable gates met, 0-100. Null when nothing was measured. */
  mbo: number | null;
  productionRate: number | null;
  dpu: number | null;
  dpo: number | null;
  /** Which gates were assessed and missed. Empty when everything applicable passed. */
  failedGates: string[];
  passing: boolean | null;
}

export interface MboRoster {
  rows: MboRow[];
  passing: number;
  failing: number;
  unscored: number;
}

/**
 * Per-employee MBO for a period, with the gates behind it.
 *
 * The gates are reported alongside the score so a failure says *why* rather
 * than only that it happened — the composite alone cannot distinguish a
 * production shortfall from a quality one.
 *
 * A gate with no data is neither passed nor failed: it is left out of the
 * score entirely, matching how the composite is computed at import.
 */
export async function getMboRoster(user: CurrentUser, period: Period): Promise<MboRoster> {
  // Scoped to the team as it stood at the end of the period, so a leader's MBO
  // roster for August lists the people whose August it actually was.
  const ids = await reportingScopeIds(user, period.end);
  if (ids.length === 0) return { rows: [], passing: 0, failing: 0, unscored: 0 };

  const [roster, metrics] = await Promise.all([
    db
      .select({
        id: employees.id,
        eid: employees.eid,
        name: employees.name,
        supervisorName: supervisorOfRecord,
      })
      .from(employees)
      .leftJoin(employeeAssignments, assignmentAt(period.end))
      .where(inArray(employees.id, ids)),
    getPeriodMetrics(ids, period),
  ]);

  const byEmployee = new Map<string, Record<string, number>>();
  for (const m of metrics) {
    const entry = byEmployee.get(m.employeeId) ?? {};
    entry[m.kpiCode] = m.actualValue;
    byEmployee.set(m.employeeId, entry);
  }

  const rows: MboRow[] = roster
    .map((r) => {
      const m = byEmployee.get(r.id) ?? {};
      const mbo = m.MBO ?? null;
      const productionRate = m.PRODUCTION_RATE ?? null;
      const dpu = m.DPU ?? null;
      const dpo = m.DPO ?? null;

      const failedGates: string[] = [];
      if (productionRate !== null && productionRate < MBO_GATES.productionRate) {
        failedGates.push("Production rate");
      }
      if (dpu !== null && dpu < MBO_GATES.dpu) failedGates.push("DPU");
      if (dpo !== null && dpo < MBO_GATES.dpo) failedGates.push("DPO");

      return {
        employeeId: r.id,
        eid: r.eid,
        name: r.name,
        supervisorName: r.supervisorName,
        mbo,
        productionRate,
        dpu,
        dpo,
        failedGates,
        passing: mbo === null ? null : mbo >= 100,
      };
    })
    .sort((a, b) => {
      // Failing first — this list exists to be worked through.
      if (a.passing === b.passing) return a.name.localeCompare(b.name);
      if (a.passing === null) return 1;
      if (b.passing === null) return -1;
      return a.passing ? 1 : -1;
    });

  return {
    rows,
    passing: rows.filter((r) => r.passing === true).length,
    failing: rows.filter((r) => r.passing === false).length,
    unscored: rows.filter((r) => r.passing === null).length,
  };
}

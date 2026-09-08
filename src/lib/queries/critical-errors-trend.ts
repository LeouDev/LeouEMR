import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employeeAssignments, employees, kpiDefinitions, metricFacts } from "@/lib/db/schema";
import { eligibleForPeriod } from "./eligibility";
import { assignmentAt, supervisorOfRecord } from "./org-history";
import type { Period } from "./period";

const UNASSIGNED = "Unassigned";

export interface CriticalErrorsTrendBucket {
  period: Period;
  /** Supervisor name -> count of critical errors in this bucket. */
  bySupervisor: Record<string, number>;
}

/**
 * Critical error counts per bucket, broken out by supervisor.
 *
 * Every bucket resolves its own org structure at its own end date — except
 * the supervisor a person's counts are attributed to, which is fixed once
 * at the LAST bucket's end and held for the whole trend. That is the same
 * simplification getOrgTrend already makes for its own per-supervisor
 * breakdown: re-resolving who reported to whom bucket-by-bucket would let
 * one person's errors split across two supervisors' lines mid-trend, which
 * reads as two different people rather than one person who moved teams.
 */
export async function getCriticalErrorsTrendBySupervisor(
  buckets: Period[],
): Promise<CriticalErrorsTrendBucket[]> {
  if (buckets.length === 0) return [];
  const asOf = buckets[buckets.length - 1].end;

  const [critical] = await db
    .select({ id: kpiDefinitions.id })
    .from(kpiDefinitions)
    .where(eq(kpiDefinitions.code, "CRITICAL_ERRORS"))
    .limit(1);
  if (!critical) return buckets.map((period) => ({ period, bySupervisor: {} }));

  const roster = await db
    .select({ employeeId: employees.id, supervisor: supervisorOfRecord })
    .from(employees)
    .leftJoin(employeeAssignments, assignmentAt(asOf));

  const rangeStart = buckets[0].start;
  const rangeEnd = buckets[buckets.length - 1].end;
  const eligible = new Set(
    await eligibleForPeriod(roster.map((r) => r.employeeId), {
      granularity: "month",
      start: rangeStart,
      end: rangeEnd,
      label: "range",
    }),
  );
  const supervisorById = new Map(
    roster.filter((r) => eligible.has(r.employeeId)).map((r) => [r.employeeId, r.supervisor ?? UNASSIGNED]),
  );
  if (supervisorById.size === 0) return buckets.map((period) => ({ period, bySupervisor: {} }));

  const facts = await db
    .select({
      employeeId: metricFacts.employeeId,
      factDate: metricFacts.factDate,
      numerator: metricFacts.numerator,
    })
    .from(metricFacts)
    .where(
      and(
        inArray(metricFacts.employeeId, [...supervisorById.keys()]),
        eq(metricFacts.kpiId, critical.id),
        gte(metricFacts.factDate, rangeStart),
        lte(metricFacts.factDate, rangeEnd),
      ),
    );

  return buckets.map((period) => {
    const bySupervisor: Record<string, number> = {};
    for (const row of facts) {
      if (row.factDate < period.start || row.factDate > period.end) continue;
      const supervisor = supervisorById.get(row.employeeId);
      if (!supervisor) continue;
      bySupervisor[supervisor] = (bySupervisor[supervisor] ?? 0) + row.numerator;
    }
    return { period, bySupervisor };
  });
}

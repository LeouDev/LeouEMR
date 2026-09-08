import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employees, kpiDefinitions, metricFacts } from "@/lib/db/schema";
import { eligibleForPeriod } from "./eligibility";
import { joinPeriodOwner, periodOwnerSubquery, supervisorOfRecord } from "./org-history";
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
 * The supervisor a person's counts are attributed to is fixed once across
 * the whole trend — whoever held them the most days of it — rather than
 * re-resolved bucket by bucket: re-resolving would let one person's errors
 * split across two supervisors' lines mid-trend, which reads as two
 * different people rather than one person who moved teams. That is the
 * same simplification getOrgTrend already makes for its own per-supervisor
 * breakdown, just anchored on the plurality-of-days rule (see
 * periodOwnerSubquery) instead of a single end-date snapshot — a
 * twelve-bucket trend should not hand a year's worth of errors to whoever
 * happened to be supervising on the very last day of it.
 */
export async function getCriticalErrorsTrendBySupervisor(
  buckets: Period[],
): Promise<CriticalErrorsTrendBucket[]> {
  if (buckets.length === 0) return [];

  const [critical] = await db
    .select({ id: kpiDefinitions.id })
    .from(kpiDefinitions)
    .where(eq(kpiDefinitions.code, "CRITICAL_ERRORS"))
    .limit(1);
  if (!critical) return buckets.map((period) => ({ period, bySupervisor: {} }));

  const rangeStart = buckets[0].start;
  const rangeEnd = buckets[buckets.length - 1].end;

  const owner = periodOwnerSubquery({ start: rangeStart, end: rangeEnd });
  const roster = await db
    .select({ employeeId: employees.id, supervisor: supervisorOfRecord(owner) })
    .from(employees)
    .leftJoin(owner, joinPeriodOwner(owner));

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

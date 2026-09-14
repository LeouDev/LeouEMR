import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import {
  employees,
  kpiDefinitions,
  metricFacts,
  monthlyMetrics,
  npsFacts,
  qualityFacts,
  scorecardReviews,
  skillFacts,
  users,
} from "@/lib/db/schema";
import { loadRampTargets, loadSkillReferences, normalize } from "@/lib/import-pipeline/par-scoring";
import { KPI_CODES, MONTHLY_METRIC_CODES } from "@/lib/import-pipeline/types";
import { computeNps } from "@/lib/kpi-engine/nps";
import { measureSkill } from "@/lib/kpi-engine/skill-result";
import {
  joinPeriodOwner,
  managerOfRecord,
  periodOwnerSubquery,
  siteOfRecord,
  supervisorOfRecord,
} from "@/lib/queries/org-history";
import { periodContaining, periodsBetween, type Period } from "@/lib/queries/period";
import { combine } from "@/lib/queries/period-metrics";
import { computeScorecard, skillGroupOf, type Scorecard, type ScorecardSkillInput } from "./engine";
import { changedSinceReview, errorWindow } from "./review";

/**
 * Reads a month's inputs for a set of people and runs the engine over
 * each. One round of queries for the whole set, so the stack rank can
 * score a few hundred cards without a few hundred trips.
 *
 * Every measure re-aggregates from the daily fact tables for the calendar
 * month — nothing here averages weekly values — the same grain the period
 * metrics use. Skills are matched to their configured reference through
 * the same aliases as the PAR rating, and a label the configuration does
 * not know is left out, as it is there.
 */
export async function computeScorecards(employeeIds: string[], monthStart: string): Promise<Map<string, Scorecard>> {
  const cards = new Map<string, Scorecard>();
  if (employeeIds.length === 0) return cards;

  const month = periodContaining("month", monthStart);
  const window = errorWindow(month.start);
  const weeks = periodsBetween("week", month.start, month.end);
  const inMonth = (column: AnyPgColumn) => and(gte(column, month.start), lte(column, month.end));

  const [refs, rampTargets, people, skills, quality, errors, attendance, nps, monthly] = await Promise.all([
    loadSkillReferences(),
    loadRampTargets(),
    db.select({ id: employees.id, eid: employees.eid }).from(employees).where(inArray(employees.id, employeeIds)),
    db
      .select({
        employeeId: skillFacts.employeeId,
        skillLabel: skillFacts.skillLabel,
        cases: sql<number>`sum(${skillFacts.cases})::double precision`,
        hours: sql<number>`sum(${skillFacts.hours})::double precision`,
        weightHours: sql<number>`sum(${skillFacts.weightHours})::double precision`,
        prodWeight: sql<number>`sum(${skillFacts.prodWeight})::double precision`,
      })
      .from(skillFacts)
      .where(and(inArray(skillFacts.employeeId, employeeIds), inMonth(skillFacts.factDate)))
      .groupBy(skillFacts.employeeId, skillFacts.skillLabel),
    db
      .select({
        employeeId: qualityFacts.employeeId,
        skillLabel: qualityFacts.skillLabel,
        audits: sql<number>`sum(${qualityFacts.audits})::int`,
        scoreSum: sql<number>`sum(${qualityFacts.scoreSum})::double precision`,
      })
      .from(qualityFacts)
      .where(and(inArray(qualityFacts.employeeId, employeeIds), inMonth(qualityFacts.factDate)))
      .groupBy(qualityFacts.employeeId, qualityFacts.skillLabel),
    db
      .select({
        employeeId: metricFacts.employeeId,
        code: kpiDefinitions.code,
        total: sql<number>`sum(${metricFacts.numerator})::double precision`,
      })
      .from(metricFacts)
      .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, metricFacts.kpiId))
      .where(
        and(
          inArray(metricFacts.employeeId, employeeIds),
          inArray(kpiDefinitions.code, [KPI_CODES.CRITICAL_ERRORS, KPI_CODES.STANDARD_ERRORS]),
          gte(metricFacts.factDate, window.start),
          lte(metricFacts.factDate, window.end),
        ),
      )
      .groupBy(metricFacts.employeeId, kpiDefinitions.code),
    db
      .select({
        employeeId: metricFacts.employeeId,
        numerator: sql<number>`sum(${metricFacts.numerator})::double precision`,
        denominator: sql<number>`sum(${metricFacts.denominator})::double precision`,
      })
      .from(metricFacts)
      .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, metricFacts.kpiId))
      .where(
        and(
          inArray(metricFacts.employeeId, employeeIds),
          eq(kpiDefinitions.code, KPI_CODES.ATTENDANCE),
          inMonth(metricFacts.factDate),
        ),
      )
      .groupBy(metricFacts.employeeId),
    db
      .select({
        employeeId: npsFacts.employeeId,
        promoters: sql<number>`sum(${npsFacts.promoters})::int`,
        passives: sql<number>`sum(${npsFacts.passives})::int`,
        detractors: sql<number>`sum(${npsFacts.detractors})::int`,
      })
      .from(npsFacts)
      .where(and(inArray(npsFacts.employeeId, employeeIds), inMonth(npsFacts.factDate)))
      .groupBy(npsFacts.employeeId),
    db
      .select({ employeeId: monthlyMetrics.employeeId, metric: monthlyMetrics.metric, value: monthlyMetrics.value })
      .from(monthlyMetrics)
      .where(and(inArray(monthlyMetrics.employeeId, employeeIds), eq(monthlyMetrics.month, month.start))),
  ]);

  const eidById = new Map(people.map((p) => [p.id, p.eid]));

  // The target a person was held to across the month: the ramp-stage target
  // for each week of a ramp, the steady target otherwise, averaged over the
  // month's weeks — the same treatment the period PAR rating gives.
  const targetFor = (employeeId: string, ref: { code: string; target: number; lowerIsBetter: boolean }) => {
    const eid = eidById.get(employeeId);
    const label = normalize(ref.code);
    let ramping = false;
    const sum = weeks.reduce((total, week) => {
      const override = eid ? rampTargets.get(`${eid}|${week.start}|${label}`) : undefined;
      const weekTarget = ref.lowerIsBetter ? (override?.ahtTarget ?? ref.target) : (override?.cphTarget ?? ref.target);
      if (override) ramping = true;
      return total + weekTarget;
    }, 0);
    return { target: weeks.length > 0 ? sum / weeks.length : ref.target, ramping };
  };

  const skillsByEmployee = new Map<string, ScorecardSkillInput[]>();
  {
    // Fold every label of one configured skill together, as the PAR rating does.
    const folded = new Map<string, Map<string, { cases: number; hours: number; weightHours: number; prodWeight: number }>>();
    for (const row of skills) {
      const ref = refs.get(normalize(row.skillLabel));
      if (!ref) continue;
      const perEmployee = folded.get(row.employeeId) ?? new Map();
      const entry = perEmployee.get(ref.code) ?? { cases: 0, hours: 0, weightHours: 0, prodWeight: 0 };
      entry.cases += row.cases;
      entry.hours += row.hours;
      entry.weightHours += row.weightHours;
      entry.prodWeight += row.prodWeight;
      perEmployee.set(ref.code, entry);
      folded.set(row.employeeId, perEmployee);
    }
    for (const [employeeId, perEmployee] of folded) {
      const inputs: ScorecardSkillInput[] = [];
      for (const [code, totals] of perEmployee) {
        const ref = refs.get(normalize(code));
        if (!ref) continue;
        const { target, ramping } = targetFor(employeeId, ref);
        inputs.push({
          code: ref.code,
          name: ref.name,
          group: skillGroupOf(ref),
          // IEX hours where the source carries them, productive hours otherwise — the PAR weighting basis.
          hours: totals.weightHours > 0 ? totals.weightHours : totals.hours,
          actual: measureSkill(ref.metric, totals),
          target,
          lowerIsBetter: ref.lowerIsBetter,
          thresholds: ref.thresholds,
          ramping,
        });
      }
      skillsByEmployee.set(employeeId, inputs);
    }
  }

  const qualityByEmployee = new Map<string, { phone: { audits: number; scoreSum: number }; ancillary: { audits: number; scoreSum: number } }>();
  for (const row of quality) {
    const ref = refs.get(normalize(row.skillLabel));
    const group = ref ? skillGroupOf(ref) : "ancillary";
    const entry = qualityByEmployee.get(row.employeeId) ?? {
      phone: { audits: 0, scoreSum: 0 },
      ancillary: { audits: 0, scoreSum: 0 },
    };
    entry[group].audits += row.audits;
    entry[group].scoreSum += row.scoreSum;
    qualityByEmployee.set(row.employeeId, entry);
  }
  const meanPct = (t: { audits: number; scoreSum: number }) => (t.audits > 0 ? (t.scoreSum / t.audits) * 100 : null);

  const errorsByEmployee = new Map<string, { critical: number; standard: number }>();
  for (const row of errors) {
    const entry = errorsByEmployee.get(row.employeeId) ?? { critical: 0, standard: 0 };
    if (row.code === KPI_CODES.CRITICAL_ERRORS) entry.critical += row.total;
    if (row.code === KPI_CODES.STANDARD_ERRORS) entry.standard += row.total;
    errorsByEmployee.set(row.employeeId, entry);
  }
  const attendanceByEmployee = new Map(attendance.map((r) => [r.employeeId, combine("ratio_pct", r.numerator, r.denominator)]));
  const npsByEmployee = new Map(nps.map((r) => [r.employeeId, computeNps(r)]));
  const monthlyByEmployee = new Map<string, Partial<Record<string, number>>>();
  for (const row of monthly) {
    monthlyByEmployee.set(row.employeeId, { ...(monthlyByEmployee.get(row.employeeId) ?? {}), [row.metric]: row.value });
  }

  for (const employeeId of employeeIds) {
    const q = qualityByEmployee.get(employeeId);
    const e = errorsByEmployee.get(employeeId);
    const m = monthlyByEmployee.get(employeeId) ?? {};
    cards.set(
      employeeId,
      computeScorecard({
        skills: skillsByEmployee.get(employeeId) ?? [],
        ancillaryQuality: q ? meanPct(q.ancillary) : null,
        phoneQuality: q ? meanPct(q.phone) : null,
        criticalErrors: e?.critical ?? 0,
        standardErrors: e?.standard ?? 0,
        nps: npsByEmployee.get(employeeId) ?? null,
        attendance: attendanceByEmployee.get(employeeId) ?? null,
        ire: m[MONTHLY_METRIC_CODES.IRE] ?? null,
        pkt: m[MONTHLY_METRIC_CODES.PKT] ?? null,
        lhUtilization: m[MONTHLY_METRIC_CODES.LH_UTILIZATION] ?? null,
      }),
    );
  }
  return cards;
}

export interface ScorecardReviewState {
  reviewedByName: string | null;
  reviewedAt: Date;
  reviewedScore: number | null;
  acknowledgedByName: string | null;
  acknowledgedAt: Date | null;
  /** The card no longer says what was reviewed — a re-import has moved it. */
  changedSinceReview: boolean;
}

export interface ScorecardPageData {
  employee: {
    id: string;
    eid: string;
    name: string;
    supervisorName: string | null;
    managerName: string | null;
    site: string | null;
  };
  month: Period;
  card: Scorecard;
  review: ScorecardReviewState | null;
}

/**
 * One person's card for one month, with its stamps. Scope is the caller's
 * to check. The supervisor, manager and site printed on the card are the
 * month's own — whoever held the person for most of it — falling back to
 * today's roster only where the history has nothing.
 */
export async function getScorecardFor(employeeId: string, monthStart: string): Promise<ScorecardPageData | null> {
  const month = periodContaining("month", monthStart);
  const owner = periodOwnerSubquery(month);
  const [[employee], cards, [review]] = await Promise.all([
    db
      .select({
        id: employees.id,
        eid: employees.eid,
        name: employees.name,
        supervisorName: sql<string | null>`coalesce(${supervisorOfRecord(owner)}, ${employees.supervisorName})`,
        managerName: sql<string | null>`coalesce(${managerOfRecord(owner)}, ${employees.managerName})`,
        site: sql<string | null>`coalesce(${siteOfRecord(owner)}, ${employees.site})`,
      })
      .from(employees)
      .leftJoin(owner, joinPeriodOwner(owner))
      .where(eq(employees.id, employeeId))
      .limit(1),
    computeScorecards([employeeId], month.start),
    db
      .select()
      .from(scorecardReviews)
      .where(and(eq(scorecardReviews.employeeId, employeeId), eq(scorecardReviews.month, month.start)))
      .limit(1),
  ]);
  if (!employee) return null;
  const card = cards.get(employeeId)!;

  let reviewState: ScorecardReviewState | null = null;
  if (review) {
    const ids = [review.reviewedBy, review.acknowledgedBy].filter((id): id is string => !!id);
    const names = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
    const nameOf = (id: string | null) => (id ? (names.find((n) => n.id === id)?.name ?? null) : null);
    reviewState = {
      reviewedByName: nameOf(review.reviewedBy),
      reviewedAt: review.reviewedAt,
      reviewedScore: review.reviewedScore,
      acknowledgedByName: nameOf(review.acknowledgedBy),
      acknowledgedAt: review.acknowledgedAt,
      changedSinceReview: changedSinceReview(review.reviewedScore, card.finalScore),
    };
  }

  return { employee, month, card, review: reviewState };
}

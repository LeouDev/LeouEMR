import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { CACHE_TAG, cachedRead, serialized } from "@/lib/cache";
import { db } from "@/lib/db/client";
import {
  employeeRampAssignments,
  employees,
  actionItems,
  actionPlanCategories,
  actionPlans,
  kpiDefinitions,
  performanceIssues,
  rcaEntries,
  rcaNotes,
  rootCauseCategories,
  skillFacts,
  skillReferences,
  weeklyMetricResults,
} from "@/lib/db/schema";
import { loadSkillReferences, normalize } from "@/lib/import-pipeline/par-scoring";
import { measureSkill } from "@/lib/kpi-engine/skill-result";
import { LAST_STAGE, rampStageForWeek } from "@/lib/ramp/engine";
import { cellsFor, type ProgressionRow, type StagedValue } from "@/lib/ramp/progression";
import { PLAN_KPI_CODES } from "./performance";
import { periodContaining } from "./period";
import { getRampSchedulesBySkill } from "./ramp-schedule";
import { reportingWeekStart } from "./week-sql";

/**
 * How each team's new hires actually performed at each stage of ramp.
 *
 * The board beside this says where someone stands today. This says whether
 * the path works: did Nesting 2 move anybody, is Week 4 where people stall,
 * is this intake ramping faster than the last. It covers every ramp on
 * record rather than only the ones running now, because a comparison across
 * ten stages is empty on the right if nobody has finished.
 *
 * It cannot be read off a calendar period. Stage 3 is a different week for
 * every person depending on when their ramp began, and an agent ramping on
 * two skills has two different stage 3s — so every fact is placed on a stage
 * through `rampStageForWeek` against its own assignment, then averaged.
 *
 * Organisation-wide and cached, then filtered to the caller's scope. This is
 * the heaviest read in the app: every ramping agent's daily skill facts and
 * weekly results across a ten-week span each. Computing it per viewer, on a
 * connection whose egress is metered, is the one thing this page must not
 * do — so the first person in after an import pays for everybody, and
 * `serialized` keeps a shift-start rush from starting it forty times at once.
 *
 * Only the team level is cached. An agent's own rows are fetched when a team
 * is opened (see loadTeamAgents), the same way the Development Hub roster
 * does it: four hundred agents times ten rows times ten stages would put the
 * cached entry past the 2 MB a data cache will hold, and silently stop being
 * cached at all.
 */

const UNASSIGNED = "Unassigned";

export interface TeamProgression {
  supervisor: string;
  /** Distinct agents with a ramp on record, however long ago. */
  agents: number;
  rows: ProgressionRow[];
}

/** One agent's own rows, in the same shape as their team's. */
export interface AgentProgression {
  employeeId: string;
  employeeName: string;
  eid: string;
  rows: ProgressionRow[];
}

/** A measured agent-week, before it is averaged into anything. */
interface Placed extends StagedValue {
  supervisor: string;
  employeeId: string;
  employeeName: string;
  eid: string;
  key: string;
  label: string;
  kind: "skill" | "kpi";
  lowerIsBetter: boolean;
}

export function getRampProgression(): Promise<TeamProgression[]> {
  return readProgression();
}

const readProgression = cachedRead(
  "ramp-progression",
  [CACHE_TAG.imports, CACHE_TAG.ramp, CACHE_TAG.reference],
  (): Promise<TeamProgression[]> => serialized("ramp-progression", computeTeams),
);

async function computeTeams(): Promise<TeamProgression[]> {
  const placed = await placeEveryRampedWeek();

  const byTeam = new Map<string, Placed[]>();
  for (const row of placed) {
    byTeam.set(row.supervisor, [...(byTeam.get(row.supervisor) ?? []), row]);
  }

  return [...byTeam.entries()]
    .map(([supervisor, rows]) => ({
      supervisor,
      agents: new Set(rows.map((r) => r.employeeId)).size,
      rows: foldRows(rows),
    }))
    .sort((a, b) => a.supervisor.localeCompare(b.supervisor));
}

/**
 * One team's agents, each with their own rows — the drill-down under a team.
 *
 * Cached on the same tags and recomputed from the same placement, because a
 * team is a slice of one organisation-wide answer rather than a question of
 * its own: computing it per team would read the same facts again for every
 * team a manager opened.
 */
export const loadTeamAgents = cachedRead(
  "ramp-progression-agents",
  [CACHE_TAG.imports, CACHE_TAG.ramp, CACHE_TAG.reference],
  async (supervisor: string): Promise<AgentProgression[]> => {
    const placed = (await placeEveryRampedWeek()).filter((row) => row.supervisor === supervisor);

    const byAgent = new Map<string, Placed[]>();
    for (const row of placed) {
      byAgent.set(row.employeeId, [...(byAgent.get(row.employeeId) ?? []), row]);
    }

    return [...byAgent.values()]
      .map((rows) => ({
        employeeId: rows[0].employeeId,
        employeeName: rows[0].employeeName,
        eid: rows[0].eid,
        rows: foldRows(rows),
      }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  },
);

/** Rows folded per measure, skills first and then the scorecard KPIs, each alphabetical. */
function foldRows(placed: readonly Placed[]): ProgressionRow[] {
  const byKey = new Map<string, Placed[]>();
  for (const row of placed) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);

  return [...byKey.values()]
    .map((rows) => ({
      key: rows[0].key,
      label: rows[0].label,
      kind: rows[0].kind,
      lowerIsBetter: rows[0].lowerIsBetter,
      cells: cellsFor(rows),
    }))
    .sort((a, b) =>
      a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "skill" ? -1 : 1,
    );
}

/**
 * Every agent-week of every ramp on record, placed on the stage it fell on.
 *
 * Read once and shared by both callers above rather than twice: the team
 * summary and a team's agents are two foldings of the same rows, and the
 * facts behind them are what costs anything.
 */
async function placeEveryRampedWeek(): Promise<Placed[]> {
  const assignments = await db
    .select({
      employeeId: employeeRampAssignments.employeeId,
      skillReferenceId: employeeRampAssignments.skillReferenceId,
      rampStartWeek: employeeRampAssignments.rampStartWeek,
      employeeName: employees.name,
      eid: employees.eid,
      supervisor: employees.supervisorName,
    })
    .from(employeeRampAssignments)
    .innerJoin(employees, eq(employees.id, employeeRampAssignments.employeeId))
    .orderBy(asc(employeeRampAssignments.rampStartWeek));

  if (assignments.length === 0) return [];

  // Nothing before the earliest ramp can belong to one, so the fact reads are
  // bounded by it rather than by the whole ledger.
  const earliest = assignments.reduce(
    (min, a) => (a.rampStartWeek < min ? a.rampStartWeek : min),
    assignments[0].rampStartWeek,
  );
  const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];

  const [facts, weekly, refs, refIds, schedules] = await Promise.all([
    db
      .select({
        employeeId: skillFacts.employeeId,
        skillLabel: skillFacts.skillLabel,
        week: sql<string>`${reportingWeekStart(skillFacts.factDate)}::text`,
        cases: sql<number>`sum(${skillFacts.cases})::double precision`,
        hours: sql<number>`sum(${skillFacts.hours})::double precision`,
        prodWeight: sql<number>`sum(${skillFacts.prodWeight})::double precision`,
      })
      .from(skillFacts)
      .where(and(inArray(skillFacts.employeeId, employeeIds), gte(skillFacts.factDate, earliest)))
      // Grouped by output position, not by repeating the expression: the
      // week rule binds its cut-over dates as parameters, and a second copy
      // binds them under different numbers, which Postgres cannot see is the
      // same expression. See week-sql.ts.
      .groupBy(skillFacts.employeeId, skillFacts.skillLabel, sql`3`),
    db
      .select({
        employeeId: weeklyMetricResults.employeeId,
        week: weeklyMetricResults.weekStart,
        code: kpiDefinitions.code,
        name: kpiDefinitions.name,
        direction: kpiDefinitions.direction,
        actualValue: weeklyMetricResults.actualValue,
      })
      .from(weeklyMetricResults)
      .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, weeklyMetricResults.kpiId))
      .where(
        and(
          inArray(weeklyMetricResults.employeeId, employeeIds),
          gte(weeklyMetricResults.weekStart, earliest),
          inArray(kpiDefinitions.code, [...PLAN_KPI_CODES]),
        ),
      ),
    loadSkillReferences(),
    // The ramp assignment points at a skill_references row by id; a fact
    // names the skill as free text, which loadSkillReferences resolves to a
    // reference by code. This is the bridge between the two.
    db.select({ id: skillReferences.id, code: skillReferences.code }).from(skillReferences),
    getRampSchedulesBySkill(),
  ]);

  const idByCode = new Map(refIds.map((row) => [row.code, row.id]));

  const placed: Placed[] = [];

  // A skill week belongs to the ramp for that skill, which is why the
  // assignment is looked up per skill rather than per person: an agent
  // ramping on Fax and PartD_Phones has two different stage 3s.
  const bySkillRef = new Map<string, typeof assignments>();
  for (const a of assignments) {
    bySkillRef.set(`${a.employeeId}|${a.skillReferenceId}`, [
      ...(bySkillRef.get(`${a.employeeId}|${a.skillReferenceId}`) ?? []),
      a,
    ]);
  }

  for (const fact of facts) {
    const ref = refs.get(normalize(fact.skillLabel));
    const refId = ref ? idByCode.get(ref.code) : undefined;
    if (!ref || !refId) continue;
    const [assignment] = bySkillRef.get(`${fact.employeeId}|${refId}`) ?? [];
    if (!assignment) continue;

    const stage = rampStageForWeek(assignment.rampStartWeek, fact.week);
    if (stage === null) continue;

    const value = measureSkill(ref.metric, fact);
    if (value === null) continue;

    placed.push({
      stage,
      value,
      target: schedules.get(refId)?.get(stage) ?? null,
      supervisor: assignment.supervisor ?? UNASSIGNED,
      employeeId: assignment.employeeId,
      employeeName: assignment.employeeName,
      eid: assignment.eid,
      key: `skill:${ref.code}`,
      label: ref.name,
      kind: "skill",
      lowerIsBetter: ref.lowerIsBetter,
    });
  }

  // A KPI week belongs to whichever of that agent's ramps was running then.
  // Where two were, the earliest names the stage: a person's onboarding is
  // one path, and their Quality that week is not two different numbers.
  const byEmployee = new Map<string, typeof assignments>();
  for (const a of assignments) {
    byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) ?? []), a]);
  }

  for (const row of weekly) {
    const forEmployee = byEmployee.get(row.employeeId) ?? [];
    let stage: number | null = null;
    let owner: (typeof assignments)[number] | undefined;
    for (const a of forEmployee) {
      const candidate = rampStageForWeek(a.rampStartWeek, row.week);
      if (candidate !== null) {
        stage = candidate;
        owner = a;
        break;
      }
    }
    if (stage === null || !owner) continue;

    placed.push({
      stage,
      value: row.actualValue,
      // No per-stage bar: nobody sets a different Quality target for Nesting 2.
      target: null,
      supervisor: owner.supervisor ?? UNASSIGNED,
      employeeId: owner.employeeId,
      employeeName: owner.employeeName,
      eid: owner.eid,
      key: `kpi:${row.code}`,
      label: row.name,
      kind: "kpi",
      lowerIsBetter: row.direction === "lower_is_better",
    });
  }

  return placed;
}

/**
 * What a supervisor wrote about one agent during one stage of their ramp.
 *
 * The stage is resolved back to a calendar week through the agent's own
 * earliest ramp assignment — the same rule the KPI rows use, since a
 * person's onboarding is one path even when they are ramping on two skills.
 *
 * Three different things, deliberately kept apart on the panel. The root
 * cause and the plan belong to the item and stand for its whole life, so
 * they are shown for any item that was open that week. The notes are the
 * genuinely per-week part: a dated line a supervisor added when the
 * circumstances that week differed from the original root cause.
 */
export interface StageNote {
  actionItemId: string;
  actionItemCode: string;
  kpiName: string;
  status: string;
  openedWeek: string;
  problemStatement: string | null;
  /** The chosen root-cause category, which is the part a reader can count. */
  rootCauseCategory: string | null;
  rootCauseDetails: string | null;
  /** Null on a plan written before the category list existed. */
  planCategory: string | null;
  correctiveAction: string | null;
  expectedBehavior: string | null;
  /** Lines written against the root cause for this week alone. */
  notes: string[];
}

export interface StageDetail {
  /** The reporting week this stage fell on for this agent, or null if unresolvable. */
  week: string | null;
  items: StageNote[];
}

export async function getStageDetail(employeeId: string, stage: number): Promise<StageDetail> {
  const assignments = await db
    .select({ rampStartWeek: employeeRampAssignments.rampStartWeek })
    .from(employeeRampAssignments)
    .where(eq(employeeRampAssignments.employeeId, employeeId))
    .orderBy(asc(employeeRampAssignments.rampStartWeek));

  const week = weekOfStage(assignments.map((a) => a.rampStartWeek), stage);
  if (week === null) return { week: null, items: [] };

  const rows = await db
    .select({
      actionItemId: actionItems.id,
      actionItemCode: actionItems.code,
      kpiName: kpiDefinitions.name,
      status: performanceIssues.status,
      openedWeek: performanceIssues.openedWeek,
      problemStatement: rcaEntries.problemStatement,
      rootCauseCategory: rootCauseCategories.label,
      rootCauseDetails: rcaEntries.rootCauseDetails,
      planCategory: actionPlanCategories.label,
      correctiveAction: actionPlans.correctiveAction,
      expectedBehavior: actionPlans.expectedBehavior,
    })
    .from(actionItems)
    .innerJoin(performanceIssues, eq(performanceIssues.id, actionItems.performanceIssueId))
    .innerJoin(kpiDefinitions, eq(kpiDefinitions.id, performanceIssues.kpiId))
    .leftJoin(rcaEntries, eq(rcaEntries.actionItemId, actionItems.id))
    .leftJoin(actionPlans, eq(actionPlans.actionItemId, actionItems.id))
    // Both categories left-joined through their own nullable columns: the
    // RCA may not be written yet, and a plan from before the category list
    // existed has prose and no category. Either way the prose still shows.
    .leftJoin(rootCauseCategories, eq(rootCauseCategories.id, rcaEntries.rootCauseCategoryId))
    .leftJoin(actionPlanCategories, eq(actionPlanCategories.id, actionPlans.categoryId))
    // Open by that week: an item opened later says nothing about it, and one
    // opened before was still the work in hand.
    .where(and(eq(performanceIssues.employeeId, employeeId), lte(performanceIssues.openedWeek, week)))
    .orderBy(asc(performanceIssues.openedWeek));

  if (rows.length === 0) return { week, items: [] };

  const notes = await db
    .select({ actionItemId: rcaNotes.actionItemId, note: rcaNotes.note })
    .from(rcaNotes)
    .where(
      and(
        inArray(rcaNotes.actionItemId, rows.map((r) => r.actionItemId)),
        eq(rcaNotes.week, week),
      ),
    )
    .orderBy(asc(rcaNotes.createdAt));

  return {
    week,
    items: rows.map((row) => ({
      ...row,
      notes: notes.filter((n) => n.actionItemId === row.actionItemId).map((n) => n.note),
    })),
  };
}

/**
 * The reporting week a stage fell on, from the earliest ramp that reaches it.
 *
 * Walked forward through `rampStageForWeek` rather than added as weeks of
 * days, so it keeps to the same reporting weeks the ledger is keyed by —
 * including the extended week at the Sunday cut-over, which plain arithmetic
 * would put every later stage one day out of.
 */
function weekOfStage(rampStartWeeks: readonly string[], stage: number): string | null {
  for (const start of rampStartWeeks) {
    let week = periodContaining("week", start);
    for (let i = 0; i <= LAST_STAGE + 1; i++) {
      if (rampStageForWeek(start, week.start) === stage) return week.start;
      week = periodContaining("week", shiftDay(week.end, 1));
    }
  }
  return null;
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

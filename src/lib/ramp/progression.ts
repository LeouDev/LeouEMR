import { LAST_STAGE, stageLabel } from "./engine";

/**
 * How a cohort actually performed at each stage of ramp, as opposed to what
 * the schedule said they should.
 *
 * The board next to this answers "where is this person today". This answers
 * the question a manager asks after a few months of it: did Nesting 2 move
 * anybody, is Week 4 where people stall, is this intake ramping faster than
 * the last one. Both need the same stage arithmetic and neither can be read
 * off a calendar period, because stage 3 is a different week for every
 * person depending on when their ramp began.
 *
 * Everything here is pure. The mapping from a week to a stage lives in
 * engine.ts; this only averages what the caller has already placed.
 */

/** Every stage, in order, with the label the board already uses. */
export const STAGES: ReadonlyArray<{ stage: number; label: string }> = Array.from(
  { length: LAST_STAGE + 1 },
  (_, stage) => ({ stage, label: stageLabel(stage) }),
);

export interface StageCell {
  /** The mean across whoever was measured at this stage; null when nobody was. */
  value: number | null;
  /**
   * The stage's target, where the measure has one. Skills do — that is what
   * skill_ramp_schedules is — and the scorecard KPIs do not: nobody sets a
   * different Quality bar for Nesting 2.
   */
  target: number | null;
  /** Agent-weeks behind the mean, so a cell built from one person can say so. */
  sample: number;
}

export const EMPTY_CELL: StageCell = { value: null, target: null, sample: 0 };

export interface ProgressionRow {
  /** Skill code or KPI code — unique within a team. */
  key: string;
  label: string;
  kind: "skill" | "kpi";
  /** AHT and seconds-per-case: a lower number is the good direction. */
  lowerIsBetter: boolean;
  /** One per stage, indexed by stage number. */
  cells: StageCell[];
}

/**
 * One agent-week's measured value, already placed on a stage by the caller.
 * The same shape serves a skill week and a KPI week.
 */
export interface StagedValue {
  stage: number;
  value: number;
  target: number | null;
}

/**
 * The mean of what was measured, per stage.
 *
 * A plain mean of agent-weeks rather than a weighted one: the question is
 * "how is a person doing at Week 3", and weighting by volume would let one
 * agent working double hours speak for the cohort. Weeks nobody was measured
 * in come back null rather than zero — an unmeasured stage is not a stage
 * anybody scored nothing in.
 *
 * The target is taken from the values rather than averaged, because a stage's
 * target is a property of the schedule and every value on one stage carries
 * the same one. Where they somehow differ the first is used and the rest are
 * ignored; a mean of two targets would be a number the schedule never set.
 */
export function cellsFor(values: readonly StagedValue[]): StageCell[] {
  const cells: StageCell[] = STAGES.map(() => ({ ...EMPTY_CELL }));
  const sums = new Map<number, { total: number; count: number }>();

  for (const entry of values) {
    if (entry.stage < 0 || entry.stage > LAST_STAGE) continue;
    if (!Number.isFinite(entry.value)) continue;

    const running = sums.get(entry.stage) ?? { total: 0, count: 0 };
    sums.set(entry.stage, { total: running.total + entry.value, count: running.count + 1 });
    const cell = cells[entry.stage];
    if (cell.target === null && entry.target !== null) cell.target = entry.target;
  }

  for (const [stage, { total, count }] of sums) {
    cells[stage] = { ...cells[stage], value: total / count, sample: count };
  }
  return cells;
}

/**
 * The bar a scorecard KPI is passed or failed against, the same at every
 * stage: the failure threshold the weekly engine uses (evaluate.ts), or the
 * target where a definition names only that. Nobody sets a different Quality
 * bar for Nesting 2, so unlike a skill's ladder it does not move — but a
 * cohort averaging 69 NPS against a bar of 80 is not passing, and reads red
 * like a skill week would. Null for the directions that have no single
 * number to compare against (a range, a yes/no).
 */
export function kpiBar(definition: {
  direction: string;
  target: number | null;
  failureThreshold: number | null;
}): number | null {
  if (definition.direction !== "higher_is_better" && definition.direction !== "lower_is_better") return null;
  return definition.failureThreshold ?? definition.target ?? null;
}

/**
 * Whether a cell met its target: the stage's, for a skill on a ramp
 * schedule; the KPI's own bar, for a scorecard measure.
 *
 * Null where there is nothing to judge — no value, or no target (a KPI
 * whose direction has no single bar).
 */
export function meetsTarget(cell: StageCell, lowerIsBetter: boolean): boolean | null {
  if (cell.value === null || cell.target === null) return null;
  return lowerIsBetter ? cell.value <= cell.target : cell.value >= cell.target;
}

/**
 * The change from the first measured stage to the last, in the direction
 * that counts as improvement.
 *
 * Positive is better for every row, including the ones where a lower number
 * is the good direction — a row that reads "-40s" for handle time and one
 * that reads "+3" for cases per hour are both progress, and a reader
 * scanning a column of them should not have to remember which is which.
 *
 * Null when fewer than two stages were measured: one point is not a trend,
 * and drawing an arrow off it would invent one.
 */
export function movement(cells: readonly StageCell[], lowerIsBetter: boolean): number | null {
  const measured = cells.filter((cell) => cell.value !== null);
  if (measured.length < 2) return null;

  const first = measured[0].value as number;
  const last = measured[measured.length - 1].value as number;
  return lowerIsBetter ? first - last : last - first;
}

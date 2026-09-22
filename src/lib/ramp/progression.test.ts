import { describe, expect, it } from "vitest";
import { LAST_STAGE } from "./engine";
import { STAGES, cellsFor, kpiBar, meetsTarget, movement } from "./progression";

const at = (stage: number, value: number, target: number | null = null) => ({ stage, value, target });

describe("STAGES", () => {
  it("covers the whole path, labelled as the board labels it", () => {
    expect(STAGES).toHaveLength(LAST_STAGE + 1);
    expect(STAGES[0].label).toBe("Nesting 1");
    expect(STAGES[1].label).toBe("Nesting 2");
    expect(STAGES[2].label).toBe("Week 1");
    expect(STAGES.at(-1)?.label).toBe("Week 8");
  });
});

describe("cellsFor", () => {
  it("averages the agent-weeks placed on a stage", () => {
    const cells = cellsFor([at(2, 10), at(2, 20), at(3, 15)]);

    expect(cells[2]).toEqual({ value: 15, target: null, sample: 2 });
    expect(cells[3]).toEqual({ value: 15, target: null, sample: 1 });
  });

  it("leaves a stage nobody was measured in null, not zero", () => {
    // An unmeasured stage is not one everybody scored nothing in, and a zero
    // would drag any mean drawn from the row.
    const cells = cellsFor([at(0, 5)]);

    expect(cells[0].value).toBe(5);
    expect(cells[1]).toEqual({ value: null, target: null, sample: 0 });
    expect(cells.every((cell, stage) => stage === 0 || cell.value === null)).toBe(true);
  });

  it("carries the stage's target without averaging it", () => {
    // A target is the schedule's, not a measurement: every value on a stage
    // carries the same one, and a mean of two would be a number nobody set.
    const cells = cellsFor([at(4, 9, 12), at(4, 11, 12)]);

    expect(cells[4]).toEqual({ value: 10, target: 12, sample: 2 });
  });

  it("weights every agent-week alike", () => {
    // Deliberately not weighted by volume: the question is how a person is
    // doing at Week 3, and one agent on double hours should not answer for
    // the cohort.
    expect(cellsFor([at(2, 0), at(2, 100)])[2].value).toBe(50);
  });

  it("ignores a stage outside the path, and a value that is not a number", () => {
    const cells = cellsFor([at(-1, 5), at(LAST_STAGE + 1, 5), at(2, Number.NaN), at(2, 8)]);

    expect(cells[2]).toEqual({ value: 8, target: null, sample: 1 });
    expect(cells).toHaveLength(LAST_STAGE + 1);
  });

  it("has a cell for every stage even with nothing to place", () => {
    expect(cellsFor([])).toHaveLength(LAST_STAGE + 1);
    expect(cellsFor([]).every((cell) => cell.value === null)).toBe(true);
  });
});

describe("meetsTarget", () => {
  it("reads the target in the direction the measure runs", () => {
    expect(meetsTarget({ value: 12, target: 10, sample: 1 }, false)).toBe(true);
    expect(meetsTarget({ value: 8, target: 10, sample: 1 }, false)).toBe(false);
    // Handle time: under the target is the good side.
    expect(meetsTarget({ value: 8, target: 10, sample: 1 }, true)).toBe(true);
    expect(meetsTarget({ value: 12, target: 10, sample: 1 }, true)).toBe(false);
  });

  it("counts meeting the target exactly as meeting it", () => {
    expect(meetsTarget({ value: 10, target: 10, sample: 1 }, false)).toBe(true);
    expect(meetsTarget({ value: 10, target: 10, sample: 1 }, true)).toBe(true);
  });

  it("judges nothing where there is no value or no target", () => {
    // A KPI whose direction has no single bar (a range, a yes/no) carries no
    // target, and pretending otherwise would fail people against a number
    // that does not exist.
    expect(meetsTarget({ value: null, target: 10, sample: 0 }, false)).toBeNull();
    expect(meetsTarget({ value: 10, target: null, sample: 1 }, false)).toBeNull();
  });
});

describe("kpiBar", () => {
  it("is the failure threshold the weekly engine uses, or the target where only that is set", () => {
    expect(kpiBar({ direction: "higher_is_better", target: 95, failureThreshold: 90 })).toBe(90);
    expect(kpiBar({ direction: "lower_is_better", target: 0, failureThreshold: null })).toBe(0);
    expect(kpiBar({ direction: "higher_is_better", target: null, failureThreshold: null })).toBeNull();
  });

  it("names no bar for a direction with no single number to compare against", () => {
    expect(kpiBar({ direction: "range", target: 50, failureThreshold: 40 })).toBeNull();
    expect(kpiBar({ direction: "boolean_match", target: 1, failureThreshold: 1 })).toBeNull();
  });

  it("colours a KPI cell the way a skill cell is coloured, against that bar", () => {
    const bar = kpiBar({ direction: "higher_is_better", target: 80, failureThreshold: 80 });
    expect(meetsTarget({ value: 69.12, target: bar, sample: 3 }, false)).toBe(false);
    expect(meetsTarget({ value: 100, target: bar, sample: 3 }, false)).toBe(true);
    const errors = kpiBar({ direction: "lower_is_better", target: 0, failureThreshold: 0 });
    expect(meetsTarget({ value: 1.25, target: errors, sample: 3 }, true)).toBe(false);
    expect(meetsTarget({ value: 0, target: errors, sample: 1 }, true)).toBe(true);
  });
});

describe("movement", () => {
  const cells = (values: Array<number | null>) =>
    values.map((value) => ({ value, target: null, sample: value === null ? 0 : 1 }));

  it("reports improvement as positive whichever way the measure runs", () => {
    // A rate that climbed and a handle time that fell are both progress, and
    // a reader scanning a column should not have to remember which is which.
    expect(movement(cells([10, null, 13]), false)).toBe(3);
    expect(movement(cells([600, null, 560]), true)).toBe(40);
  });

  it("reports a decline as negative, both ways round", () => {
    expect(movement(cells([13, 10]), false)).toBe(-3);
    expect(movement(cells([560, 600]), true)).toBe(-40);
  });

  it("measures first to last, skipping the stages in between", () => {
    expect(movement(cells([5, 99, 99, 8]), false)).toBe(3);
  });

  it("calls nothing a trend from a single point", () => {
    expect(movement(cells([10]), false)).toBeNull();
    expect(movement(cells([null, null]), false)).toBeNull();
    expect(movement([], false)).toBeNull();
  });
});

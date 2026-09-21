import { describe, expect, it } from "vitest";
import { STAGES } from "./progression";
import { EXPORT_HEADER, exportFilename, exportRows } from "./progression-export";

const row = (label: string, kind: "skill" | "kpi", values: Array<[number, number | null]>) => ({
  key: `${kind}:${label}`,
  label,
  kind,
  lowerIsBetter: false,
  cells: STAGES.map(({ stage }) => {
    const found = values[stage];
    return found
      ? { value: found[0], target: found[1], sample: 1 }
      : { value: null, target: null, sample: 0 };
  }),
});

describe("EXPORT_HEADER", () => {
  it("names a column per stage, three times over, plus the fixed ones", () => {
    // Value, target and sample for each stage, after the seven identifying
    // columns and before Movement.
    expect(EXPORT_HEADER).toHaveLength(7 + STAGES.length * 3 + 1);
    expect(EXPORT_HEADER.slice(0, 7)).toEqual([
      "Team", "Level", "Agent", "EID", "Measure", "Kind", "Direction",
    ]);
    expect(EXPORT_HEADER[7]).toBe("Nesting 1");
    expect(EXPORT_HEADER.at(-1)).toBe("Movement");
  });
});

describe("exportRows", () => {
  const team = { supervisor: "Sacurom", agentName: "", eid: "", rows: [row("Fax", "skill", [[5, 4]])] };
  const agent = {
    supervisor: "Sacurom",
    agentName: "Requina,Hazel",
    eid: "900078897",
    rows: [row("Fax", "skill", [[6, 4]])],
  };

  it("flattens a team and its agents into one table, told apart by level", () => {
    const rows = exportRows([team, agent]);

    expect(rows).toHaveLength(2);
    expect(rows[0].slice(0, 5)).toEqual(["Sacurom", "Team", "", "", "Fax"]);
    expect(rows[1].slice(0, 5)).toEqual(["Sacurom", "Agent", "Requina,Hazel", "900078897", "Fax"]);
  });

  it("writes numbers as numbers so the file can be averaged", () => {
    const [line] = exportRows([team]);

    expect(line[7]).toBe(5);
    expect(line[7 + STAGES.length]).toBe(4);
    expect(line[7 + STAGES.length * 2]).toBe(1);
  });

  it("leaves an unmeasured stage empty rather than zero or a dash", () => {
    // A zero is a measurement nobody took and would drag any total drawn
    // from the file; a dash makes the whole column text.
    const [line] = exportRows([team]);

    expect(line[8]).toBe("");
    expect(line[8 + STAGES.length]).toBe("");
    // The sample count is genuinely zero, which is a fact rather than a gap.
    expect(line[8 + STAGES.length * 2]).toBe(0);
  });

  it("carries the movement, and leaves it empty from a single stage", () => {
    const [single] = exportRows([team]);
    expect(single.at(-1)).toBe("");

    const [pair] = exportRows([
      { ...team, rows: [row("Fax", "skill", [[5, 4], [8, 4]])] },
    ]);
    expect(pair.at(-1)).toBe(3);
  });

  it("has nothing to write for nobody", () => {
    expect(exportRows([])).toEqual([]);
    expect(exportRows([{ ...team, rows: [] }])).toEqual([]);
  });
});

describe("exportFilename", () => {
  it("dates the file", () => {
    expect(exportFilename("2026-09-21")).toBe("ramp-progression-2026-09-21");
  });

  it("keeps anything a filesystem would mind out of it", () => {
    expect(exportFilename('../../etc/passwd"')).toBe("ramp-progression-etcpasswd");
  });
});

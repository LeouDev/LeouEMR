import { describe, expect, it } from "vitest";
import { csvOf } from "@/lib/csv";
import type { MboRow } from "@/lib/queries/mbo";
import { MBO_EXPORT_HEADER, mboExportFilename, mboExportRows } from "./export";

const herbias = "Archiene Ross Calderon Herbias";

const rows: MboRow[] = [
  {
    employeeId: "e1",
    eid: "900292132",
    name: "Alba,Dorellyn",
    supervisorName: herbias,
    mbo: 66.666,
    productionRate: 0.81234,
    dpu: 99.04,
    dpo: 98.5,
    failedGates: ["Production rate"],
    passing: false,
  },
  {
    employeeId: "e2",
    eid: "900292164",
    name: "Advincula,Ronn Rafael",
    supervisorName: herbias,
    mbo: 100,
    productionRate: 1.3,
    dpu: 100,
    dpo: 100,
    failedGates: [],
    passing: true,
  },
  {
    employeeId: "e3",
    eid: "002233004",
    name: "Aniban,Brandon Saludaga",
    supervisorName: null,
    mbo: null,
    productionRate: null,
    dpu: null,
    dpo: null,
    failedGates: [],
    passing: null,
  },
];

describe("mboExportRows", () => {
  it("writes one line per agent under their team leader, with the gates rounded as figures", () => {
    const out = mboExportRows(rows, "all");
    expect(out).toEqual([
      [herbias, "Alba,Dorellyn", "900292132", 66.7, "Failing", 0.812, 99, 98.5, "Production rate", 50],
      [herbias, "Advincula,Ronn Rafael", "900292164", 100, "Passing", 1.3, 100, 100, "", 50],
      ["Unassigned", "Aniban,Brandon Saludaga", "002233004", "", "No score", "", "", "", "", ""],
    ]);
    for (const line of out) expect(line).toHaveLength(MBO_EXPORT_HEADER.length);
  });

  it("keeps only the tab's rows but still reports the whole team's pass rate", () => {
    const out = mboExportRows(rows, "fail");
    expect(out).toHaveLength(1);
    expect(out[0][1]).toBe("Alba,Dorellyn");
    expect(out[0][9]).toBe(50);
  });

  it("produces a CSV a spreadsheet opens with a header row", () => {
    const csv = csvOf([[...MBO_EXPORT_HEADER], ...mboExportRows(rows, "all")]);
    expect(csv.split("\r\n")[0]).toBe('"Team leader","Employee","EID","MBO %","Result","Production rate","DPU %","DPO %","Gates missed","Team pass rate %"');
    expect(csv).toContain('"Alba,Dorellyn","900292132","66.7","Failing"');
  });

  it("names the file by the period and the tab", () => {
    expect(mboExportFilename("2026-09-01", "all")).toBe("mbo-2026-09-01-everyone");
    expect(mboExportFilename("2026-08-30", "fail")).toBe("mbo-2026-08-30-failing");
    expect(mboExportFilename("2026-09-01", "unscored")).toBe("mbo-2026-09-01-no-score");
  });
});

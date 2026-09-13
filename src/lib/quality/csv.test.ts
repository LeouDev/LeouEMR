import { describe, expect, it } from "vitest";
import { allFindingsRows, auditRawRows, csvOf, safeFilename, type ExportAudit } from "./csv";
import { QA_FORM_SEED } from "./forms";
import { findingRows, itemKey } from "./scoring";

const faxForm = QA_FORM_SEED.find((f) => f.key === "faxqa")!;

const AUDIT: ExportAudit = {
  agentName: "Reyes, Kristian",
  agentEid: "001895123",
  form: faxForm,
  auditDate: "2026-09-10",
  evaluatorName: "Lopez, Ana",
  headerValues: { caseNo: "FX-40213", callReason: "New PA Initiation" },
  remarks: 'Documentation: said "will call back"',
  scorePct: 82.76,
  isCritical: false,
  findings: findingRows(faxForm.definition, { [itemKey("Documentation", 1)]: "fail" }),
};

describe("csvOf", () => {
  it("quotes every cell, doubles inner quotes and ends rows with CRLF", () => {
    expect(csvOf([["a", 'say "hi"', 3], [null, undefined]])).toBe('"a","say ""hi""","3"\r\n"",""\r\n');
  });
});

describe("auditRawRows", () => {
  it("leads with the header block, then one row per attribute, then remarks and score", () => {
    const rows = auditRawRows(AUDIT);
    expect(rows.slice(0, 7)).toEqual([
      ["Agent", "Reyes, Kristian"],
      ["Employee ID", "001895123"],
      ["Form", "Fax QA Form"],
      ["Date", "2026-09-10"],
      ["Evaluator", "Lopez, Ana"],
      ["Case #", "FX-40213"],
      ["Call Reason", "New PA Initiation"],
    ]);
    expect(rows[8]).toEqual(["Category", "Attribute", "Result"]);
    expect(rows).toContainEqual(["Documentation", "b. Did not document whom they spoke to", "FAIL"]);
    expect(rows).toContainEqual(["Compliance", "Wrong member selected", "PASS"]);
    expect(rows[rows.length - 3]).toEqual(["Remarks", 'Documentation: said "will call back"']);
    expect(rows[rows.length - 2]).toEqual(["Overall score (%)", 82.76]);
    expect(rows[rows.length - 1]).toEqual(["Critical error", "NO"]);
  });
});

describe("allFindingsRows", () => {
  it("flattens every audit to one row per finding under a single header", () => {
    const rows = allFindingsRows([AUDIT, { ...AUDIT, agentName: "Santos, Maria", findings: AUDIT.findings.slice(0, 2) }]);
    expect(rows[0][5]).toBe("Category");
    expect(rows).toHaveLength(1 + AUDIT.findings.length + 2);
    expect(rows[rows.length - 1].slice(0, 3)).toEqual(["Santos, Maria", "001895123", "Fax QA Form"]);
    expect(rows[1].slice(5, 8)).toEqual(["Provider Information", "a. Incorrect provider selected", "PASS"]);
  });
});

describe("safeFilename", () => {
  it("keeps only characters every browser accepts", () => {
    expect(safeFilename("qa-audit", "Reyes, Kristian", "2026-09-10")).toBe("qa-audit-Reyes_Kristian-2026-09-10");
  });
});

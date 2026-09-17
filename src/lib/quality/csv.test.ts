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
  transactionDate: "2026-09-08",
  evaluatorName: "Lopez, Ana",
  headerValues: { caseNo: "FX-40213", techDecision: "Approved", callReason: "New PA Initiation" },
  remarks: 'Documentation: said "will call back"',
  scorePct: 95,
  isCritical: false,
  findings: findingRows(faxForm.definition, { [itemKey("Documentation", 1)]: "fail" }),
  timeMotion: null,
};

const phoneForm = QA_FORM_SEED.find((f) => f.key === "phone")!;
const PHONE_AUDIT: ExportAudit = {
  ...AUDIT,
  form: phoneForm,
  headerValues: {},
  findings: findingRows(phoneForm.definition, {}),
  timeMotion: {
    callReference: "REC-88213",
    segments: [
      { label: "Greeting / verification", baselineSeconds: 30, actualSeconds: 28 },
      { label: "Account lookup", baselineSeconds: 60, actualSeconds: 75 },
    ],
  },
};

describe("csvOf", () => {
  it("quotes every cell, doubles inner quotes and ends rows with CRLF", () => {
    expect(csvOf([["a", 'say "hi"', 3], [null, undefined]])).toBe('"a","say ""hi""","3"\r\n"",""\r\n');
  });

  it("keeps a text cell that starts like a formula as text, and leaves numbers alone", () => {
    expect(csvOf([["=1+1", "-5", "+12s", "@x", -5]])).toBe('" =1+1"," -5"," +12s"," @x","-5"\r\n');
  });
});

describe("auditRawRows", () => {
  it("leads with the header block, then one row per attribute, then remarks and score", () => {
    const rows = auditRawRows(AUDIT);
    expect(rows.slice(0, 8)).toEqual([
      ["Agent", "Reyes, Kristian"],
      ["Employee ID", "001895123"],
      ["Form", "Fax QA Form"],
      ["Date", "2026-09-10"],
      ["Transaction date", "2026-09-08"],
      ["Evaluator", "Lopez, Ana"],
      ["Case #", "FX-40213"],
      ["Tech Decision", "Approved"],
    ]);
    // The form retired Call Reason; an audit that recorded one still exports
    // it, because an export that drops a recorded value is not raw data.
    expect(rows).toContainEqual(["Call Reason (retired)", "New PA Initiation"]);
    // Found rather than indexed: the header block's length moves whenever a
    // form gains or retires a field, and a hardcoded row number makes an
    // unrelated change look like a broken export.
    const attributes = rows.findIndex((r) => r[0] === "Category");
    expect(rows[attributes]).toEqual(["Category", "Attribute", "Result"]);
    expect(rows[attributes - 1]).toEqual([]);
    expect(rows).toContainEqual([
      "Documentation",
      "Agent failed to document additional PA Types",
      "FAIL",
    ]);
    expect(rows).toContainEqual(["Compliance", "Fax Priority", "PASS"]);
    expect(rows[rows.length - 3]).toEqual(["Remarks", 'Documentation: said "will call back"']);
    expect(rows[rows.length - 2]).toEqual(["Overall score (%)", 95]);
    expect(rows[rows.length - 1]).toEqual(["Critical error", "NO"]);
  });
});

describe("Time & Motion in the exports", () => {
  it("adds a timing block to one audit's raw data, between the header and the attributes", () => {
    const rows = auditRawRows(PHONE_AUDIT);
    const start = rows.findIndex((r) => r[0] === "Time & Motion — Call reference");
    expect(rows[start]).toEqual(["Time & Motion — Call reference", "REC-88213"]);
    expect(rows[start + 1]).toEqual(["Segment", "Baseline (s)", "Actual (s)", "Delta (s)"]);
    expect(rows[start + 2]).toEqual(["Greeting / verification", 30, 28, -2]);
    expect(rows[start + 3]).toEqual(["Account lookup", 60, 75, 15]);
    expect(rows[start + 5]).toEqual(["Category", "Attribute", "Result"]);
    expect(auditRawRows(AUDIT).some((r) => r[0] === "Time & Motion — Call reference")).toBe(false);
  });

  it("adds one row per segment to the bulk export under its own category", () => {
    const rows = allFindingsRows([PHONE_AUDIT]);
    const timing = rows.filter((r) => r[6] === "Time & Motion");
    expect(timing).toHaveLength(2);
    expect(timing[1].slice(6, 9)).toEqual(["Time & Motion", "Account lookup (baseline 60s, actual 75s)", 15]);
    expect(rows).toHaveLength(1 + PHONE_AUDIT.findings.length + 2);
  });
});

describe("allFindingsRows", () => {
  it("flattens every audit to one row per finding under a single header", () => {
    const rows = allFindingsRows([AUDIT, { ...AUDIT, agentName: "Santos, Maria", findings: AUDIT.findings.slice(0, 2) }]);
    expect(rows[0][6]).toBe("Category");
    expect(rows).toHaveLength(1 + AUDIT.findings.length + 2);
    expect(rows[rows.length - 1].slice(0, 3)).toEqual(["Santos, Maria", "001895123", "Fax QA Form"]);
    expect(rows[1].slice(6, 9)).toEqual(["Provider Information", "Agent selected Incorrect Provider", "PASS"]);
  });
});

describe("safeFilename", () => {
  it("keeps only characters every browser accepts", () => {
    expect(safeFilename("qa-audit", "Reyes, Kristian", "2026-09-10")).toBe("qa-audit-Reyes_Kristian-2026-09-10");
  });
});

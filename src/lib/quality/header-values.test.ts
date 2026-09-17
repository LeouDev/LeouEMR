import { describe, expect, it } from "vitest";
import { QA_FORM_SEED, TECH_DECISION_OPTIONS } from "./forms";
import { headerRows } from "./header-values";

const FIELDS = [
  { key: "caseNo", label: "Case #" },
  { key: "techDecision", label: "Tech Decision" },
];

describe("headerRows", () => {
  it("lists the form's own fields in form order", () => {
    expect(headerRows(FIELDS, { techDecision: "Approved", caseNo: "FX-40213" })).toEqual([
      { label: "Case #", value: "FX-40213" },
      { label: "Tech Decision", value: "Approved" },
    ]);
  });

  it("keeps a value the form has since stopped asking for, named as it was", () => {
    // The whole point: an audit filed when Fax QA asked for a call reason
    // would otherwise show nothing for the one header it recorded.
    expect(headerRows(FIELDS, { caseNo: "FX-40213", callReason: "New PA Initiation" })).toEqual([
      { label: "Case #", value: "FX-40213" },
      { label: "Call Reason (retired)", value: "New PA Initiation" },
    ]);
  });

  it("puts the retired value after the current ones, not among them", () => {
    const rows = headerRows(FIELDS, {
      caseNo: "FX-40213",
      techDecision: "Pend",
      callReason: "Status Check-Pending",
    });

    expect(rows.map((r) => r.label)).toEqual(["Case #", "Tech Decision", "Call Reason (retired)"]);
  });

  it("shows a key nobody recognises under its own name rather than dropping it", () => {
    expect(headerRows(FIELDS, { somethingOld: "kept" })).toEqual([
      { label: "somethingOld", value: "kept" },
    ]);
  });

  it("skips a field with nothing recorded, so the block has no empty lines", () => {
    expect(headerRows(FIELDS, { caseNo: "", techDecision: "Deny", callReason: "" })).toEqual([
      { label: "Tech Decision", value: "Deny" },
    ]);
  });

  it("has nothing to show for an audit with no header values at all", () => {
    expect(headerRows(FIELDS, {})).toEqual([]);
  });
});

describe("the forms' own headers", () => {
  const form = (key: string) => QA_FORM_SEED.find((f) => f.key === key)!;
  const second = (key: string) => form(key).headerFields[1];

  it("asks the AV, MPA and Fax forms for the tech decision, all twelve codes", () => {
    for (const key of ["avqa", "mpaqa", "faxqa"]) {
      expect(second(key)).toMatchObject({
        key: "techDecision",
        label: "Tech Decision",
        kind: "select",
        options: TECH_DECISION_OPTIONS,
      });
    }
    expect(TECH_DECISION_OPTIONS).toEqual([
      "Pend",
      "Deny",
      "Approved",
      "Fax for Appls",
      "Merged",
      "RARA",
      "RAFA",
      "RAFC-C",
      "NEITAP",
      "NEITP",
      "DNF",
      "MNF",
    ]);
  });

  it("leaves the Phone form on Call Reason, which is a call's question", () => {
    expect(second("phone")).toMatchObject({ key: "callReason", label: "Call Reason" });
  });

  it("asks no form for a call reason and a tech decision at once", () => {
    for (const seeded of QA_FORM_SEED) {
      const keys = seeded.headerFields.map((f) => f.key);
      expect(keys.includes("callReason") && keys.includes("techDecision")).toBe(false);
    }
  });
});

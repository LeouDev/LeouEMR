import type { QaForm } from "./forms";
import { headerRows } from "./header-values";
import type { FindingRow } from "./scoring";
import type { StoredTimeMotion } from "./time-motion";

// Re-exported so this module stays the one import for a quality export.
export { CSV_BOM } from "../csv-bom";

/**
 * Plain CSV: every cell quoted, CRLF rows. A text cell that starts with a
 * character Excel reads as a formula gets a leading space, so a remark or
 * a case number typed as "=..." or "-..." stays text.
 */
export function csvOf(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const cell = (value: string | number | null | undefined) => {
    const text = typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? ` ${value}` : String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export interface ExportAudit {
  agentName: string;
  agentEid: string;
  form: QaForm;
  auditDate: string;
  /** The date of the call, case or fax; null on audits filed before it was asked for. */
  transactionDate: string | null;
  evaluatorName: string;
  headerValues: Record<string, string>;
  remarks: string | null;
  scorePct: number;
  isCritical: boolean;
  findings: FindingRow[];
  /** Present on forms that log it (the Phone form). */
  timeMotion: StoredTimeMotion | null;
}

/** One audit's raw data: its header block, then one row per attribute, then remarks and score. */
export function auditRawRows(audit: ExportAudit): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    ["Agent", audit.agentName],
    ["Employee ID", audit.agentEid],
    ["Form", audit.form.label],
    ["Date", audit.auditDate],
    ["Transaction date", audit.transactionDate ?? ""],
    ["Evaluator", audit.evaluatorName],
  ];
  // Includes a header this form has since retired, where the audit carries
  // one — an export that quietly drops a recorded value is not raw data.
  for (const row of headerRows(audit.form.headerFields, audit.headerValues)) {
    rows.push([row.label, row.value]);
  }
  if (audit.timeMotion) {
    rows.push([]);
    rows.push(["Time & Motion — Call reference", audit.timeMotion.callReference]);
    rows.push(["Segment", "Baseline (s)", "Actual (s)", "Delta (s)"]);
    for (const seg of audit.timeMotion.segments) {
      rows.push([seg.label, seg.baselineSeconds, seg.actualSeconds, seg.actualSeconds - seg.baselineSeconds]);
    }
  }
  rows.push([]);
  rows.push(["Category", "Attribute", "Result"]);
  for (const finding of audit.findings) rows.push([finding.category, finding.attribute, finding.result.toUpperCase()]);
  rows.push([]);
  rows.push(["Remarks", audit.remarks ?? ""]);
  rows.push(["Overall score (%)", audit.scorePct]);
  rows.push(["Critical error", audit.isCritical ? "YES" : "NO"]);
  return rows;
}

export const ALL_FINDINGS_HEADER = [
  "Agent",
  "Employee ID",
  "Form",
  "Date",
  "Transaction date",
  "Evaluator",
  "Category",
  "Attribute",
  "Result",
  "Remarks",
  "Score (%)",
  "Critical",
];

/** Every finding across every audit, one row each — the one bulk export. */
export function allFindingsRows(audits: readonly ExportAudit[]): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [ALL_FINDINGS_HEADER];
  for (const audit of audits) {
    for (const finding of audit.findings) {
      rows.push([
        audit.agentName,
        audit.agentEid,
        audit.form.label,
        audit.auditDate,
        audit.transactionDate ?? "",
        audit.evaluatorName,
        finding.category,
        finding.attribute,
        finding.result.toUpperCase(),
        audit.remarks ?? "",
        audit.scorePct,
        audit.isCritical ? "YES" : "NO",
      ]);
    }
    // The call timings ride along as rows of their own category, the
    // delta in the result column, so one file still carries everything.
    for (const seg of audit.timeMotion?.segments ?? []) {
      rows.push([
        audit.agentName,
        audit.agentEid,
        audit.form.label,
        audit.auditDate,
        audit.transactionDate ?? "",
        audit.evaluatorName,
        "Time & Motion",
        `${seg.label} (baseline ${seg.baselineSeconds}s, actual ${seg.actualSeconds}s)`,
        seg.actualSeconds - seg.baselineSeconds,
        audit.remarks ?? "",
        audit.scorePct,
        audit.isCritical ? "YES" : "NO",
      ]);
    }
  }
  return rows;
}

/** A file name safe for every browser: letters, digits, dots and dashes only. */
export function safeFilename(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean)
    .join("-");
}

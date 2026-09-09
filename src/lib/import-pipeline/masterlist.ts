import * as XLSX from "xlsx";
import { resolveColumns, toText } from "./columns";
import type { ValidationIssue } from "./types";

/** One agent's org structure as stated by a monthly masterlist row. */
export interface ParsedMasterlistRow {
  agentEid: string;
  agentName: string | null;
  supervisorName: string | null;
  supervisorEid: string | null;
  managerName: string | null;
  site: string | null;
}

export interface MasterlistParseResult {
  rows: ParsedMasterlistRow[];
  issues: ValidationIssue[];
  rowsRead: number;
}

const MASTERLIST_COLUMNS = {
  agentEid: ["Agent EID", "EID", "Employee ID", "EmployeeID"],
  agentName: ["Agent Name", "Employee Name", "Name"],
  supervisorName: ["Supervisor Name", "Current Supervisor", "Supervisor"],
  supervisorEid: ["Supervisor EID", "Current Sup EID", "Sup EID"],
  managerName: ["Manager Name", "Deputy Manager", "Manager"],
  site: ["Site", "SiteLocation", "Site Location"],
};

const EID_PATTERN = /^\d{9}$/;

/** The sheet name the template writes instructions to — never the data sheet. */
const README_SHEET = "read me";

/**
 * Parses a monthly masterlist upload into rows, one per agent.
 *
 * Deliberately narrow compared to the weekly workbook parser: a masterlist
 * states one thing per agent (their current site/manager/supervisor), not a
 * grid of daily metrics, so there is exactly one sheet to read and no
 * per-KPI aggregation to do.
 */
export function parseMasterlistBuffer(buffer: ArrayBuffer | Buffer): MasterlistParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const sheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() !== README_SHEET);
  if (!sheetName) {
    return {
      rows: [],
      issues: [{ severity: "error", sheet: "", message: "No data sheet found in this file", count: 0 }],
      rowsRead: 0,
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  if (records.length === 0) {
    return { rows: [], issues: [], rowsRead: 0 };
  }

  const headers = Object.keys(records[0]);
  const columns = resolveColumns(headers, MASTERLIST_COLUMNS);
  if (!columns.agentEid) {
    return {
      rows: [],
      issues: [
        {
          severity: "error",
          sheet: sheetName,
          message: "No Agent EID column found — check the file matches the masterlist template",
          count: 0,
        },
      ],
      rowsRead: records.length,
    };
  }

  const issues: ValidationIssue[] = [];
  const rows: ParsedMasterlistRow[] = [];
  const seenEids = new Set<string>();
  let missingEid = 0;
  let badEid = 0;
  let duplicateEid = 0;
  let missingOrg = 0;

  for (const record of records) {
    const eidRaw = toText(record[columns.agentEid]);
    if (!eidRaw) {
      missingEid += 1;
      continue;
    }
    // Excel drops a leading zero from anything it reads as a number, so a
    // short numeric EID is padded back out rather than rejected — the same
    // tolerance the weekly workbook's own EID handling already relies on
    // being possible, since this is the same 9-digit identifier.
    const eid = eidRaw.padStart(9, "0");
    if (!EID_PATTERN.test(eid)) {
      badEid += 1;
      continue;
    }
    if (seenEids.has(eid)) {
      duplicateEid += 1;
      continue;
    }
    seenEids.add(eid);

    const supervisorName = columns.supervisorName ? toText(record[columns.supervisorName]) : null;
    const supervisorEid = columns.supervisorEid ? toText(record[columns.supervisorEid]) : null;
    const managerName = columns.managerName ? toText(record[columns.managerName]) : null;
    const site = columns.site ? toText(record[columns.site]) : null;
    if (!supervisorName && !managerName && !site) missingOrg += 1;

    rows.push({
      agentEid: eid,
      agentName: columns.agentName ? toText(record[columns.agentName]) : null,
      supervisorName,
      supervisorEid: supervisorEid ? supervisorEid.padStart(9, "0") : null,
      managerName,
      site,
    });
  }

  if (missingEid > 0) {
    issues.push({ severity: "error", sheet: sheetName, message: "Row has no Agent EID", count: missingEid });
  }
  if (badEid > 0) {
    issues.push({
      severity: "error",
      sheet: sheetName,
      message: "Agent EID is not 9 digits",
      count: badEid,
    });
  }
  if (duplicateEid > 0) {
    issues.push({
      severity: "error",
      sheet: sheetName,
      message: "Duplicate Agent EID in this file — only the first occurrence was kept",
      count: duplicateEid,
    });
  }
  if (missingOrg > 0) {
    issues.push({
      severity: "warning",
      sheet: sheetName,
      message: "Row has no Supervisor, Manager, or Site at all",
      count: missingOrg,
    });
  }

  return { rows, issues, rowsRead: records.length };
}

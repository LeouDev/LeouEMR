/**
 * Tolerant column resolution.
 *
 * The source workbook names the same concept differently on every sheet
 * (SUPERVISOR / Supervisor / Current Supervisor / Supervisor Name;
 * Manager / DeputyManager / Deputy Manager), so nothing here matches on
 * exact headers. Each canonical field lists candidate header names in
 * priority order and the first one present on the sheet wins.
 */

export type HeaderMap = Record<string, string>;

/** Normalizes a header for comparison: lowercase, alphanumerics only. */
function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolves canonical field names to the sheet's actual headers.
 * Candidates are tried in order, so put the most specific first.
 */
export function resolveColumns(
  headers: string[],
  candidates: Record<string, string[]>,
): HeaderMap {
  const exact = new Set(headers);
  const byNormalized = new Map<string, string>();
  for (const header of headers) {
    const key = normalize(header);
    // First header wins, so duplicated names don't clobber the earlier one.
    if (!byNormalized.has(key)) byNormalized.set(key, header);
  }

  const resolved: HeaderMap = {};
  for (const [field, options] of Object.entries(candidates)) {
    // An exact header match wins over a normalized one. Sheets can contain
    // two headers that normalize identically ("Compliance Risk" holding a
    // 0/1 flag and "ComplianceRisk" holding the label); without this, only
    // whichever appears first is ever reachable.
    const exactMatch = options.find((option) => exact.has(option));
    if (exactMatch) {
      resolved[field] = exactMatch;
      continue;
    }

    for (const option of options) {
      const match = byNormalized.get(normalize(option));
      if (match) {
        resolved[field] = match;
        break;
      }
    }
  }
  return resolved;
}

/** Candidate headers shared by every sheet. */
export const IDENTITY_COLUMNS = {
  eid: ["EID", "Employee ID", "EmployeeID"],
  name: ["EMPLOYEENAME", "Employee Name", "AgentName", "FULLNAME", "Agent Name", "Name"],
  supervisorName: [
    "Current Supervisor",
    "Supervisor Name",
    "SUPERVISOR",
    "Supervisor",
  ],
  supervisorEid: ["Current Sup EID", "Sup EID", "SupEID"],
  managerName: ["DeputyManager", "Deputy Manager", "DEPUTYMANAGER", "Manager"],
  site: ["SITELOCATION", "Site", "SiteLocation"],
  skillType: ["SKILLTYPE", "SkillType", "Skill Type", "SkillSet", "PROCESSNAME"],
  week: ["Weekly", "WEEKLY", "Week"],
};

/**
 * Parses the source workbook's week label into ISO week-start/week-end dates.
 * Labels look like "WE 08/28/26" — a week-ending Friday in MM/DD/YY.
 * Returns null for anything that doesn't parse, so callers can report the
 * row rather than silently bucketing it into the wrong week.
 */
export function parseWeekLabel(label: unknown): { weekStart: string; weekEnd: string } | null {
  if (typeof label !== "string") return null;

  const match = label.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;

  const [, mm, dd, yy] = match;
  const month = Number(mm);
  const day = Number(dd);
  const yearPart = Number(yy);
  const year = yearPart < 100 ? 2000 + yearPart : yearPart;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const end = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(end.getTime())) return null;

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);

  return { weekStart: toIsoDate(start), weekEnd: toIsoDate(end) };
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Coerces a spreadsheet cell to a finite number, or null if it isn't one. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === "--") return null;
    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Coerces a cell to a trimmed non-empty string, or null. */
export function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text === "-" || text === "--") return null;
  return text;
}

/**
 * An EID as the app stores it: nine digits, leading zeros included.
 *
 * Excel keeps an all-digit cell as a number unless the column is text, so
 * the same person arrives as "001305110" from one sheet and 1305110 from
 * another. Everything that matches people on an EID — a team leader's
 * account, the roster, the period owner — compares the padded form, so an
 * unpadded one matches nobody. Anything that is not purely digits is kept
 * as written.
 */
export function normalizeEid(value: unknown): string | null {
  const text = toText(value);
  if (text === null) return null;
  return /^\d{1,9}$/.test(text) ? text.padStart(9, "0") : text;
}

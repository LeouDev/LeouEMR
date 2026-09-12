/**
 * The 201 file's list: which of a leader's reports to show and how many at
 * a time.
 *
 * Sifting happens in the browser. The page already reads every report in
 * the leader's scope in one query, and a few hundred rows of text are far
 * quicker to filter where the keystroke happens than to round-trip for.
 */

export type EmployeeStanding = "active" | "on_leave" | "separated";

/** The personnel details captured at sign-up. */
export interface PersonnelProfile {
  employeeEid: string;
  msid: string | null;
  lastName: string;
  firstName: string;
  middleName: string | null;
  position: string;
  addressLine1: string | null;
  addressLine2: string | null;
  cityProvince: string | null;
  country: string | null;
  zipcode: string | null;
  phoneNumber: string | null;
  emergencyContactName: string | null;
  emergencyContactNumber: string | null;
  emergencyContactRelationship: string | null;
}

export interface PersonnelRow {
  id: string;
  eid: string;
  /** The name as the roster spells it — the only one an unregistered person has. */
  name: string;
  site: string | null;
  supervisorName: string | null;
  managerName: string | null;
  standing: EmployeeStanding;
  email: string | null;
  /** Null until the person has signed up. */
  profile: PersonnelProfile | null;
}

export type Registration = "registered" | "unregistered" | "all";

export interface PersonnelFilters {
  query: string;
  supervisor: string;
  site: string;
  standing: "" | EmployeeStanding;
  registration: Registration;
}

/** What the page opens on: the registered records, as it always showed. */
export const DEFAULT_FILTERS: PersonnelFilters = {
  query: "",
  supervisor: "",
  site: "",
  standing: "",
  registration: "registered",
};

/** Rows on the page before the reader scrolls for more. */
export const PAGE_SIZE = 20;

export const STANDING_LABELS: Record<EmployeeStanding, string> = {
  active: "Active",
  on_leave: "On leave",
  separated: "Separated",
};

export function filtersActive(filters: PersonnelFilters): boolean {
  return (Object.keys(DEFAULT_FILTERS) as (keyof PersonnelFilters)[]).some(
    (key) => filters[key] !== DEFAULT_FILTERS[key],
  );
}

/** "Last, First M." from the profile, or the roster's spelling before there is one. */
export function displayName(row: PersonnelRow): string {
  const p = row.profile;
  if (!p) return row.name;
  return `${p.lastName}, ${p.firstName}${p.middleName ? ` ${p.middleName.charAt(0)}.` : ""}`;
}

export function formatAddress(p: PersonnelProfile): string {
  return [p.addressLine1, p.addressLine2, p.cityProvince, p.country, p.zipcode].filter(Boolean).join(", ");
}

/** Case, accents and the punctuation names and emails carry all fold away. */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, " ")
    .toLowerCase();
}

/** Every space-separated term must appear somewhere in what the row shows. */
function matchesQuery(row: PersonnelRow, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fold(
    [
      row.name,
      displayName(row),
      row.eid,
      row.profile?.msid,
      row.email,
      row.profile?.phoneNumber,
      row.profile?.position,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return terms.every((term) => haystack.includes(term));
}

export function filterPersonnel(rows: readonly PersonnelRow[], filters: PersonnelFilters): PersonnelRow[] {
  return rows.filter(
    (row) =>
      (filters.registration === "all" || (filters.registration === "registered") === (row.profile !== null)) &&
      (!filters.supervisor || row.supervisorName === filters.supervisor) &&
      (!filters.site || row.site === filters.site) &&
      (!filters.standing || row.standing === filters.standing) &&
      matchesQuery(row, filters.query),
  );
}

/** The distinct team leaders and sites among the rows, for the selects. */
export function personnelFacets(rows: readonly PersonnelRow[]): { supervisors: string[]; sites: string[] } {
  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
  return {
    supervisors: distinct(rows.map((r) => r.supervisorName)),
    sites: distinct(rows.map((r) => r.site)),
  };
}

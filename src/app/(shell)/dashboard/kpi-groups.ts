/**
 * How KPIs are grouped and ordered, shared by every dashboard view.
 *
 * Deliberately its own module with no "use client" directive. These began
 * life in agent-performance.tsx, which is a client component, and a server
 * component that imports a plain value from a client module does not get the
 * value — it gets a client reference proxy. The array survived typechecking
 * and the build, then threw "KPI_ORDER.indexOf is not a function" at request
 * time and took the whole dashboard down. A neutral module is importable from
 * both sides.
 */
export const KPI_GROUPS: Array<{ name: string; codes: string[] }> = [
  { name: "Composite", codes: ["MBO"] },
  // Case rate sits with the other output measures: it is what a case-rate
  // agent is scored on in place of cases per hour, never alongside it.
  { name: "Output", codes: ["PRODUCTION_RATE", "CPH", "CASE_RATE", "AHT"] },
  { name: "Quality", codes: ["QUALITY", "DPU", "DPO", "CRITICAL_ERRORS"] },
  { name: "Engagement", codes: ["ATTENDANCE", "NPS"] },
];

/** Headline measures first, matching the order the groups are read in. */
export const KPI_ORDER: string[] = KPI_GROUPS.flatMap((g) => g.codes);

/** Sort key; anything unrecognised sorts last rather than first. */
export function orderIndex(code: string): number {
  const i = KPI_ORDER.indexOf(code);
  return i < 0 ? 99 : i;
}

export function directionLabel(direction: string): string | null {
  if (direction === "higher_is_better") return "Higher is better";
  if (direction === "lower_is_better") return "Lower is better";
  return null;
}

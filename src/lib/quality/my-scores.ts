import { outcomeOf, type QaMark } from "./scoring";

/**
 * An agent's own audit history, summarised for My Quality Scores. Every
 * number comes from the stored audits and their results; nothing is
 * estimated, and the same pass rule as the leaders' analysis applies.
 */

export interface MyResult {
  position: number;
  category: string;
  attribute: string;
  isCompliance: boolean;
  result: QaMark;
}

export interface MyAudit {
  id: string;
  formLabel: string;
  auditDate: string;
  /** The date of the call, case or fax; null on audits filed before it was asked for. */
  transactionDate: string | null;
  evaluatorName: string;
  scorePct: number;
  isCritical: boolean;
  remarks: string | null;
  /** ISO timestamp, or null until the agent acknowledges. */
  acknowledgedAt: string | null;
  /** Every scored attribute, in form order. */
  results: MyResult[];
}

export type ScoreTone = "pass" | "ink" | "fail";

export function scoreTone(scorePct: number, isCritical = false): ScoreTone {
  const outcome = outcomeOf(scorePct, isCritical);
  return outcome === "pass" ? "pass" : outcome === "monitor" ? "ink" : "fail";
}

export interface MyKpi {
  label: string;
  value: string;
  tone: ScoreTone;
}

export interface TrendPoint {
  id: string;
  /** "Sep 9" */
  label: string;
  scorePct: number;
  /** Any attribute failed on that audit — drawn in red rather than green. */
  hadFail: boolean;
}

export interface MySummary {
  kpis: MyKpi[];
  /** Oldest first. */
  trend: TrendPoint[];
  /** Most frequent failed attributes, most first. */
  focus: Array<{ label: string; count: number }>;
}

const FOCUS_TOP = 8;

export function failedFindings(audit: MyAudit): MyResult[] {
  return audit.results.filter((r) => r.result === "fail");
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Oldest first, and within a day in the order they were filed. */
export function byDate(audits: readonly MyAudit[]): MyAudit[] {
  return [...audits].sort((a, b) => a.auditDate.localeCompare(b.auditDate));
}

export function summarizeMine(audits: readonly MyAudit[]): MySummary {
  const sorted = byDate(audits);
  const n = sorted.length;
  const avg = n ? sorted.reduce((sum, a) => sum + a.scorePct, 0) / n : null;
  const passed = sorted.filter((a) => outcomeOf(a.scorePct, a.isCritical) === "pass").length;
  const passRate = n ? (passed / n) * 100 : null;
  const latest = sorted[n - 1] ?? null;

  const kpis: MyKpi[] = [
    { label: "Audits received", value: String(n), tone: "ink" },
    { label: "Average score", value: avg === null ? "—" : `${Math.round(avg)}%`, tone: avg === null ? "ink" : scoreTone(avg) },
    { label: "Pass rate", value: passRate === null ? "—" : `${Math.round(passRate)}%`, tone: passRate === null ? "ink" : scoreTone(passRate) },
    {
      label: "Latest score",
      value: latest ? `${Math.round(latest.scorePct)}%` : "—",
      tone: latest ? scoreTone(latest.scorePct, latest.isCritical) : "ink",
    },
  ];

  const trend = sorted.map((a) => ({
    id: a.id,
    label: shortDate(a.auditDate),
    scorePct: a.scorePct,
    hadFail: failedFindings(a).length > 0,
  }));

  const counts = new Map<string, number>();
  for (const audit of sorted) {
    for (const finding of failedFindings(audit)) {
      const label = `${finding.category}: ${finding.attribute}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const focus = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, FOCUS_TOP);

  return { kpis, trend, focus };
}

/** The full scored form, grouped by category in form order — for the drawer's expanded view. */
export function groupedResults(audit: MyAudit): Array<{ name: string; items: MyResult[] }> {
  const groups: Array<{ name: string; items: MyResult[] }> = [];
  for (const result of [...audit.results].sort((a, b) => a.position - b.position)) {
    const last = groups[groups.length - 1];
    if (last && last.name === result.category) last.items.push(result);
    else groups.push({ name: result.category, items: [result] });
  }
  return groups;
}

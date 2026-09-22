import { outcomeOf } from "./scoring";
import { auditWeekOf, weekLabel } from "./week";

/**
 * The Team QA Analysis numbers, computed from stored audits and their
 * failed findings — nothing here is estimated. The page picks a window by
 * grain (the last 14 days, 12 weeks or 12 months), and every "vs prior
 * period" compares that window with the one of equal length before it.
 */

export type Grain = "daily" | "weekly" | "monthly";
export type GroupBy = "leader" | "manager";

export const GRAIN_LABELS: Record<Grain, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
export const GROUP_LABELS: Record<GroupBy, string> = { leader: "Team leader", manager: "Manager" };

export function parseGrain(value: string | undefined): Grain {
  return value === "weekly" || value === "monthly" ? value : "daily";
}

export function parseGroupBy(value: string | undefined): GroupBy {
  return value === "manager" ? "manager" : "leader";
}

export interface Bucket {
  key: string;
  label: string;
  start: string;
  end: string;
}

export interface AnalysisWindow {
  grain: Grain;
  start: string;
  end: string;
  priorStart: string;
  priorEnd: string;
  buckets: Bucket[];
}

const BUCKETS: Record<Grain, number> = { daily: 14, weekly: 12, monthly: 12 };

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: string, months: number): string {
  const d = utc(monthStart(date));
  d.setUTCMonth(d.getUTCMonth() + months);
  return iso(d);
}

const shortDay = (date: string) => utc(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const shortMonth = (date: string) => utc(date).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

/** The buckets ending on `today`, oldest first, and the equal-length window before them. */
export function windowFor(grain: Grain, today: string): AnalysisWindow {
  const n = BUCKETS[grain];
  const buckets: Bucket[] = [];

  if (grain === "daily") {
    for (let i = n - 1; i >= 0; i--) {
      const day = addDays(today, -i);
      buckets.push({ key: day, label: shortDay(day), start: day, end: day });
    }
  } else if (grain === "weekly") {
    const current = auditWeekOf(today);
    for (let i = n - 1; i >= 0; i--) {
      const start = addDays(current.start, -7 * i);
      const week = auditWeekOf(start);
      buckets.push({ key: week.start, label: shortDay(week.start), start: week.start, end: week.end });
    }
  } else {
    for (let i = n - 1; i >= 0; i--) {
      const start = addMonths(today, -i);
      const end = addDays(addMonths(start, 1), -1);
      buckets.push({ key: start.slice(0, 7), label: shortMonth(start), start, end });
    }
  }

  const start = buckets[0].start;
  const end = buckets[buckets.length - 1].end;
  const span = Math.round((utc(end).getTime() - utc(start).getTime()) / 86_400_000) + 1;
  return { grain, start, end, priorStart: addDays(start, -span), priorEnd: addDays(start, -1), buckets };
}

export interface AuditSummary {
  id: string;
  agentName: string;
  supervisorName: string | null;
  managerName: string | null;
  auditDate: string;
  scorePct: number;
  isCritical: boolean;
  /** The form the audit was scored on; the failure drill-down is per form. */
  formKey: string;
  formLabel: string;
}

export interface FailSummary {
  auditId: string;
  category: string;
  attribute: string;
  isCompliance: boolean;
}

export interface Kpi {
  label: string;
  value: string;
  /** Signed change against the prior window, already worded; null when nothing to compare. */
  delta: string | null;
  /** Whether the change is good news. */
  improved: boolean | null;
}

/** A failed category with the attributes failed under it, most first. */
export interface CategoryDrill {
  label: string;
  count: number;
  /** Share of the failures in view, whole percent. */
  share: number;
  attributes: Array<{ label: string; count: number }>;
}

export interface Analysis {
  kpis: Kpi[];
  trend: { buckets: string[]; scores: Array<number | null>; criticals: number[] };
  groups: Array<{ label: string; avg: number; count: number }>;
  outcome: { passed: number; failed: number; critical: number };
  /**
   * The forms audited in the window, for the failure drill-down's picker:
   * how many audits each had, and how many failed attributes.
   */
  forms: Array<{ key: string; label: string; audits: number; fails: number }>;
  /** The form the failure lists below are narrowed to; null for every form. */
  form: string | null;
  categories: Array<{ label: string; count: number }>;
  findings: Array<{ label: string; count: number }>;
  /** Every failed category in view, each opening onto its attributes. */
  drill: CategoryDrill[];
  total: number;
}

const TOP = 8;

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function inRange(date: string, start: string, end: string): boolean {
  return start <= date && date <= end;
}

function passed(audit: AuditSummary): boolean {
  return outcomeOf(audit.scorePct, audit.isCritical) === "pass";
}

function signed(value: number, unit: string, decimals = 0): string {
  const text = Math.abs(value).toFixed(decimals);
  return `${value >= 0 ? "▲ +" : "▼ −"}${text}${unit} vs prior period`;
}

/**
 * Everything the analysis page draws. `audits` and `fails` may include the
 * prior window; only the window's own rows are charted, the prior ones
 * feed the deltas.
 */
export function summarize(
  audits: readonly AuditSummary[],
  fails: readonly FailSummary[],
  window: AnalysisWindow,
  groupBy: GroupBy,
  /** Narrow the failure lists to one form's audits; anything not audited in the window means every form. */
  formKey: string | null = null,
): Analysis {
  const current = audits.filter((a) => inRange(a.auditDate, window.start, window.end));
  const prior = audits.filter((a) => inRange(a.auditDate, window.priorStart, window.priorEnd));
  const currentIds = new Set(current.map((a) => a.id));

  const avg = average(current.map((a) => a.scorePct));
  const priorAvg = average(prior.map((a) => a.scorePct));
  const passRate = current.length ? (current.filter(passed).length / current.length) * 100 : null;
  const priorPassRate = prior.length ? (prior.filter(passed).length / prior.length) * 100 : null;
  const critical = current.filter((a) => a.isCritical).length;
  const priorCritical = prior.filter((a) => a.isCritical).length;

  const kpis: Kpi[] = [
    {
      label: "Total audits",
      value: String(current.length),
      delta: prior.length || current.length ? signed(current.length - prior.length, "") : null,
      improved: prior.length || current.length ? current.length >= prior.length : null,
    },
    {
      label: "Avg audit score",
      value: avg === null ? "—" : `${avg.toFixed(1)}%`,
      delta: avg !== null && priorAvg !== null ? signed(avg - priorAvg, " pts", 1) : null,
      improved: avg !== null && priorAvg !== null ? avg >= priorAvg : null,
    },
    {
      label: "Pass rate",
      value: passRate === null ? "—" : `${passRate.toFixed(0)}%`,
      delta: passRate !== null && priorPassRate !== null ? signed(passRate - priorPassRate, " pts", 0) : null,
      improved: passRate !== null && priorPassRate !== null ? passRate >= priorPassRate : null,
    },
    {
      label: "Critical errors",
      value: String(critical),
      delta: prior.length || current.length ? signed(critical - priorCritical, "") : null,
      improved: prior.length || current.length ? critical <= priorCritical : null,
    },
  ];

  const scores = window.buckets.map((b) => {
    const value = average(current.filter((a) => inRange(a.auditDate, b.start, b.end)).map((a) => a.scorePct));
    return value === null ? null : Math.round(value * 10) / 10;
  });
  const criticals = window.buckets.map(
    (b) => current.filter((a) => a.isCritical && inRange(a.auditDate, b.start, b.end)).length,
  );

  const groupMap = new Map<string, number[]>();
  for (const audit of current) {
    const key = (groupBy === "leader" ? audit.supervisorName : audit.managerName) ?? "Unassigned";
    groupMap.set(key, [...(groupMap.get(key) ?? []), audit.scorePct]);
  }
  const groups = [...groupMap.entries()]
    .map(([label, values]) => ({ label, avg: Math.round((average(values) ?? 0) * 10) / 10, count: values.length }))
    .sort((a, b) => b.avg - a.avg || a.label.localeCompare(b.label));

  const passedCount = current.filter(passed).length;
  const outcome = { passed: passedCount, critical, failed: current.length - passedCount - critical };

  // The forms audited in the window, and the failures each carries. The
  // failure lists below are per form when one is picked: a category on
  // the Fax form and one on the Phones form are different questions,
  // and a count across both blames neither.
  const formOfAudit = new Map(current.map((a) => [a.id, a.formKey]));
  const currentFails = fails.filter((f) => currentIds.has(f.auditId));
  const formMap = new Map<string, { key: string; label: string; audits: number; fails: number }>();
  for (const audit of current) {
    const entry = formMap.get(audit.formKey) ?? { key: audit.formKey, label: audit.formLabel, audits: 0, fails: 0 };
    entry.audits += 1;
    formMap.set(audit.formKey, entry);
  }
  for (const fail of currentFails) {
    const entry = formMap.get(formOfAudit.get(fail.auditId)!);
    if (entry) entry.fails += 1;
  }
  const forms = [...formMap.values()].sort((a, b) => b.audits - a.audits || a.label.localeCompare(b.label));
  const form = formKey !== null && formMap.has(formKey) ? formKey : null;
  const inView = form === null ? currentFails : currentFails.filter((f) => formOfAudit.get(f.auditId) === form);

  const categoryCounts = new Map<string, number>();
  const findingCounts = new Map<string, number>();
  const attributesByCategory = new Map<string, Map<string, number>>();
  for (const fail of inView) {
    categoryCounts.set(fail.category, (categoryCounts.get(fail.category) ?? 0) + 1);
    const finding = `${fail.category}: ${fail.attribute}`;
    findingCounts.set(finding, (findingCounts.get(finding) ?? 0) + 1);
    const attributes = attributesByCategory.get(fail.category) ?? new Map<string, number>();
    attributes.set(fail.attribute, (attributes.get(fail.attribute) ?? 0) + 1);
    attributesByCategory.set(fail.category, attributes);
  }
  const byCount = (a: { label: string; count: number }, b: { label: string; count: number }) =>
    b.count - a.count || a.label.localeCompare(b.label);
  const ranked = (counts: Map<string, number>) =>
    [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort(byCount)
      .slice(0, TOP);
  const drill: CategoryDrill[] = [...categoryCounts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      share: inView.length === 0 ? 0 : Math.round((count / inView.length) * 100),
      attributes: [...(attributesByCategory.get(label) ?? new Map<string, number>()).entries()]
        .map(([attribute, n]) => ({ label: attribute, count: n }))
        .sort(byCount),
    }))
    .sort(byCount);

  return {
    kpis,
    trend: { buckets: window.buckets.map((b) => b.label), scores, criticals },
    groups,
    outcome,
    forms,
    form,
    categories: ranked(categoryCounts),
    findings: ranked(findingCounts),
    drill,
    total: current.length,
  };
}

/** The window's own span, worded for the page. */
export function windowLabel(window: AnalysisWindow): string {
  if (window.grain === "weekly") {
    return `${weekLabel(auditWeekOf(window.start)).split(" – ")[0]} – ${weekLabel(auditWeekOf(window.end)).split(" – ")[1]}`;
  }
  const fmt = (date: string) =>
    utc(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${fmt(window.start)} – ${fmt(window.end)}`;
}

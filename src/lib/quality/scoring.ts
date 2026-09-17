import type { QaDefinition } from "./forms";

/**
 * How an audit is scored, in one place: the stepper's live score, the
 * server's stored score and the tests all run this.
 *
 * Every scored attribute is marked pass or fail; an attribute nobody
 * touched is a pass. A category-weighted form forfeits a category's whole
 * weight on any failed criterion; a flat-weighted form deducts each failed
 * item's own points. Any compliance failure is an automatic zero, whatever
 * the rest says — that is the definition of a critical error.
 */

export type QaMark = "pass" | "fail";

/** Attribute key → mark. Keys come from `stepsOf`; anything else is ignored. */
export type QaMarks = Record<string, QaMark>;

export const PASS_THRESHOLD = 90;
export const MONITOR_THRESHOLD = 70;

export const COMPLIANCE_STEP = "Compliance (auto-fail)";
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

export interface QaStepItem {
  key: string;
  /** As written on the form: lettered on a category-weighted form. */
  label: string;
  /** The item's own points on a flat-weighted form; null where the category carries the weight. */
  points: number | null;
  /**
   * Set on a sub-attribute: the key of the item whose points it shares. The
   * pair (or the group) forfeits those points once, not once each.
   */
  sharesWith?: string;
}

export interface QaStep {
  name: string;
  kind: "section" | "group" | "compliance";
  /** The category's weight on a category-weighted form; the items' total otherwise; null for compliance. */
  weight: number | null;
  items: QaStepItem[];
}

export function itemKey(category: string, index: number): string {
  return `${category}::${index}`;
}

/** The form as the stepper walks it: one step per category, compliance last. */
export function stepsOf(definition: QaDefinition): QaStep[] {
  const steps: QaStep[] =
    definition.type === "A"
      ? definition.sections.map((section) => ({
          name: section.name,
          kind: "section",
          weight: section.weight,
          items: section.items.map((label, i) => ({ key: itemKey(section.name, i), label: `${LETTERS[i]}. ${label}`, points: null })),
        }))
      : definition.groups.map((group) => {
          // Sub-attributes are walked inline, in the order they are written,
          // so the stepper and the stored `position` follow the paper form.
          const items: QaStepItem[] = [];
          for (const item of group.items) {
            const key = itemKey(group.name, items.length);
            items.push({ key, label: item.label, points: item.points });
            for (const sub of item.subItems ?? []) {
              // points: null, not 0 — it has none of its own, and the form
              // must not read "0 pts" beside a check that can cost five.
              items.push({ key: itemKey(group.name, items.length), label: sub, points: null, sharesWith: key });
            }
          }
          return {
            name: group.name,
            kind: "group",
            // Only the parents carry points, so the total is theirs alone.
            weight: group.items.reduce((sum, item) => sum + item.points, 0),
            items,
          };
        });
  steps.push({
    name: COMPLIANCE_STEP,
    kind: "compliance",
    weight: null,
    items: definition.compliance.map((label, i) => ({ key: itemKey("compliance", i), label, points: null })),
  });
  return steps;
}

/** Every key a mark may carry for this form. */
export function markKeys(definition: QaDefinition): Set<string> {
  return new Set(stepsOf(definition).flatMap((step) => step.items.map((item) => item.key)));
}

export interface StepScore {
  name: string;
  earned: number;
  max: number;
  anyFail: boolean;
}

export interface AuditScore {
  earned: number;
  max: number;
  /** Two decimals, 0–100; zero on a critical error. */
  scorePct: number;
  isCritical: boolean;
  steps: StepScore[];
}

export function scoreAudit(definition: QaDefinition, marks: QaMarks): AuditScore {
  const steps = stepsOf(definition);
  const failed = (item: QaStepItem) => marks[item.key] === "fail";

  const scored: StepScore[] = [];
  let earned = 0;
  let max = 0;
  let isCritical = false;

  for (const step of steps) {
    const anyFail = step.items.some(failed);
    if (step.kind === "compliance") {
      if (anyFail) isCritical = true;
      scored.push({ name: step.name, earned: 0, max: 0, anyFail });
      continue;
    }
    const stepMax = step.weight ?? 0;
    const stepEarned =
      step.kind === "section"
        ? anyFail
          ? 0
          : stepMax
        : step.items.reduce((sum, item) => {
            // A sub-attribute has no points of its own; it can only cost its
            // parent's, which the parent's own branch accounts for.
            if (item.sharesWith) return sum;
            const sharedFail = step.items.some((other) => other.sharesWith === item.key && failed(other));
            return sum + (failed(item) || sharedFail ? 0 : (item.points ?? 0));
          }, 0);
    earned += stepEarned;
    max += stepMax;
    scored.push({ name: step.name, earned: stepEarned, max: stepMax, anyFail });
  }

  const pct = isCritical || max === 0 ? 0 : Math.round((earned / max) * 10_000) / 100;
  return { earned: isCritical ? 0 : earned, max, scorePct: pct, isCritical, steps: scored };
}

export type QaOutcome = "auto-fail" | "pass" | "monitor" | "fail";

export function outcomeOf(scorePct: number, isCritical: boolean): QaOutcome {
  if (isCritical) return "auto-fail";
  if (scorePct >= PASS_THRESHOLD) return "pass";
  if (scorePct >= MONITOR_THRESHOLD) return "monitor";
  return "fail";
}

export const OUTCOME_LABELS: Record<QaOutcome, string> = {
  "auto-fail": "Auto-fail",
  pass: "Pass",
  monitor: "Monitor",
  fail: "Fail",
};

export interface FindingRow {
  position: number;
  category: string;
  attribute: string;
  isCompliance: boolean;
  result: QaMark;
}

/** One row per scored attribute, in form order — what the raw-data export and the analytics read. */
export function findingRows(definition: QaDefinition, marks: QaMarks): FindingRow[] {
  const rows: FindingRow[] = [];
  for (const step of stepsOf(definition)) {
    for (const item of step.items) {
      rows.push({
        position: rows.length,
        category: step.kind === "compliance" ? "Compliance" : step.name,
        attribute: item.label,
        isCompliance: step.kind === "compliance",
        result: marks[item.key] === "fail" ? "fail" : "pass",
      });
    }
  }
  return rows;
}

/** "Category: note | Category: note", in form order, skipping empty notes. */
export function concatRemarks(definition: QaDefinition, remarks: Record<string, string>): string {
  return stepsOf(definition)
    .map((step) => ({ name: step.name, text: (remarks[step.name] ?? "").trim() }))
    .filter((entry) => entry.text !== "")
    .map((entry) => `${entry.name}: ${entry.text}`)
    .join(" | ");
}

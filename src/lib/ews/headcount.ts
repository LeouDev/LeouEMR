/**
 * Monthly headcount arithmetic for the EWS Headcount tab. Pure: the stored
 * rows are a team leader's entries per month, everything else is derived
 * here so the page and the tests agree by construction.
 *
 *   opening = the stored override if set, else the previous month's
 *             closing (January's opening is 0 without an override)
 *   attrition = voluntary + involuntary
 *   closing = opening + new hires + transfer in − transfer out − attrition
 */

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface HeadcountEntry {
  /** 1 to 12. */
  month: number;
  openingOverride: number | null;
  newHires: number;
  transferIn: number;
  transferOut: number;
  voluntaryAttrition: number;
  involuntaryAttrition: number;
}

export interface HeadcountMonth extends HeadcountEntry {
  label: string;
  opening: number;
  attrition: number;
  closing: number;
  /** Whether a team leader has recorded anything for the month. */
  recorded: boolean;
}

export function emptyEntry(month: number): HeadcountEntry {
  return { month, openingOverride: null, newHires: 0, transferIn: 0, transferOut: 0, voluntaryAttrition: 0, involuntaryAttrition: 0 };
}

/** The twelve months in order, each opening on the one before, from the months a leader has recorded. */
export function headcountChain(entries: readonly HeadcountEntry[]): HeadcountMonth[] {
  const byMonth = new Map(entries.map((e) => [e.month, e]));
  const out: HeadcountMonth[] = [];
  for (let month = 1; month <= 12; month++) {
    const stored = byMonth.get(month);
    const e = stored ?? emptyEntry(month);
    const opening = e.openingOverride ?? (month === 1 ? 0 : out[month - 2].closing);
    const attrition = e.voluntaryAttrition + e.involuntaryAttrition;
    out.push({
      ...e,
      label: MONTH_LABELS[month - 1],
      opening,
      attrition,
      closing: opening + e.newHires + e.transferIn - e.transferOut - attrition,
      recorded: stored !== undefined,
    });
  }
  return out;
}

/** Several teams' chains as one: each month's figures added up, the override meaningless and left null. */
export function sumChains(chains: readonly HeadcountMonth[][]): HeadcountMonth[] {
  const out: HeadcountMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const months = chains.map((c) => c[i]);
    const sum = (pick: (m: HeadcountMonth) => number) => months.reduce((total, m) => total + pick(m), 0);
    out.push({
      month: i + 1,
      label: MONTH_LABELS[i],
      openingOverride: null,
      newHires: sum((m) => m.newHires),
      transferIn: sum((m) => m.transferIn),
      transferOut: sum((m) => m.transferOut),
      voluntaryAttrition: sum((m) => m.voluntaryAttrition),
      involuntaryAttrition: sum((m) => m.involuntaryAttrition),
      opening: sum((m) => m.opening),
      attrition: sum((m) => m.attrition),
      closing: sum((m) => m.closing),
      recorded: months.some((m) => m.recorded),
    });
  }
  return out;
}

export interface HeadcountStats {
  /** December's closing. */
  projectedEoy: number;
  ytdNewHires: number;
  ytdVoluntary: number;
  ytdInvoluntary: number;
  /** Year-to-date attrition over January's opening, whole-tenth percent; null when January opened on nothing. */
  attritionPct: number | null;
  /** The last month with anything recorded, worded for the cards ("Jan through Sep"); null when nothing is. */
  through: string | null;
}

export function headcountStats(chain: readonly HeadcountMonth[]): HeadcountStats {
  const ytdNewHires = chain.reduce((s, m) => s + m.newHires, 0);
  const ytdVoluntary = chain.reduce((s, m) => s + m.voluntaryAttrition, 0);
  const ytdInvoluntary = chain.reduce((s, m) => s + m.involuntaryAttrition, 0);
  const january = chain[0].opening;
  const last = [...chain].reverse().find((m) => m.recorded);
  return {
    projectedEoy: chain[11].closing,
    ytdNewHires,
    ytdVoluntary,
    ytdInvoluntary,
    attritionPct: january > 0 ? Math.round(((ytdVoluntary + ytdInvoluntary) / january) * 1000) / 10 : null,
    through: last ? (last.month === 1 ? "January" : `Jan through ${last.label}`) : null,
  };
}

/** The year the page opens on absent a choice, and the span the picker offers. */
export function parseYear(value: string | undefined, today: string): number {
  const thisYear = Number(today.slice(0, 4));
  const n = Number(value);
  return Number.isInteger(n) && n >= 2000 && n <= thisYear + 1 ? n : thisYear;
}

import { normalizeSkill } from "@/lib/kpi-engine/quality-metrics";

/**
 * IEX schedule activity codes, and the skill each one is worked on.
 *
 * The schedule names a seat, not a skill: two different Fax queues sit under
 * separate activity codes, and the tracker has to score both against the Fax
 * target. Mapping is by activity code rather than by fuzzy-matching the skill
 * name directly, because "CSBO-PA-CRG-Part D" resolves to Fax and would
 * otherwise be matched against the PartD_Phones reference, which is an AHT
 * skill measured in seconds.
 *
 * `skillCode` matches skill_references.code, so a target read from the
 * database joins straight onto these without a second lookup table.
 */
export const ACTIVITY_SKILLS = [
  { activity: "CSBO-PA-OGS Fax", skillCode: "fax" },
  { activity: "CSBO-PA-Fax Only", skillCode: "fax" },
  { activity: "CSBO-PA-CRG-Part D", skillCode: "fax" },
  { activity: "CSBO-PA-CRG-Chart Checkers", skillCode: "glp_1" },
  { activity: "CSBO-PA-Outreach", skillCode: "outreach" },
  { activity: "CSBO-PA-Edits Team", skillCode: "edits" },
  { activity: "CSBO-PA-Outcome Calls", skillCode: "ocn" },
] as const;

export type ActivityCode = (typeof ACTIVITY_SKILLS)[number]["activity"];

/** Normalised form of each activity code, built once. */
const NORMALIZED = ACTIVITY_SKILLS.map((entry) => ({
  ...entry,
  norm: normalizeSkill(entry.activity),
}));

export interface ActivityMatch {
  /** The activity code this resolved to. */
  activity: ActivityCode;
  skillCode: string;
  /**
   * False when the text only came within the edit-distance threshold. An
   * approximate match is never counted on its own — see the note on
   * `matchActivity` — because the codes are one edit apart from strings that
   * are not on this list at all.
   */
  exact: boolean;
  /** Levenshtein distance on the normalised strings; 0 for an exact match. */
  distance: number;
}

/** Edit distance, iterative two-row form. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * How far a normalised string may stray and still be offered as a match.
 *
 * Measured on the normalised string, which is the string the distance is
 * measured on too. The original tool took this from the un-normalised name,
 * so "CSBO-PA-CRG-Part D" (18 characters) allowed 4 edits against a 14
 * character normalised form — nearly a third of it.
 */
function threshold(norm: string): number {
  return Math.min(2, Math.floor(norm.length * 0.15));
}

/**
 * Resolves scanned text to an activity code, or null.
 *
 * Returns the match rather than the matched name, and never rewrites the
 * caller's text. That distinction is the point: "CSBO-PA-CRG-Part B" is one
 * edit from "CSBO-PA-CRG-Part D" and no threshold can separate them, so an
 * approximate match is reported as approximate and the caller is expected to
 * put it in front of a human before counting its hours. Replacing the text
 * with the matched name — what the original did — destroys the only evidence
 * that review could act on.
 */
export function matchActivity(text: string): ActivityMatch | null {
  const norm = normalizeSkill(text);
  if (!norm) return null;

  const exact = NORMALIZED.find((entry) => entry.norm === norm);
  if (exact) return { activity: exact.activity, skillCode: exact.skillCode, exact: true, distance: 0 };

  // A neighbouring column sometimes folds onto the same OCR line — a status
  // word, "Approved", "AUX" — so the activity code can appear as a PREFIX of
  // the scanned text without being all of it. Checked before edit distance,
  // because a few trailing characters from an unrelated column can push a
  // perfectly-read activity name past any threshold that also has to stay
  // tight enough to keep Part B out of Part D. A prefix match is never
  // "exact" — something was appended that the known code does not have —
  // so it still lands in front of a human before it is trusted.
  const prefixed = NORMALIZED.filter((entry) => entry.norm.length > 0 && norm.startsWith(entry.norm)).sort(
    (a, b) => b.norm.length - a.norm.length,
  )[0];
  if (prefixed) {
    return {
      activity: prefixed.activity,
      skillCode: prefixed.skillCode,
      exact: false,
      distance: norm.length - prefixed.norm.length,
    };
  }

  let best: (typeof NORMALIZED)[number] | null = null;
  let bestDistance = Infinity;
  for (const entry of NORMALIZED) {
    const distance = levenshtein(norm, entry.norm);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }

  if (!best || bestDistance > threshold(best.norm)) return null;
  return { activity: best.activity, skillCode: best.skillCode, exact: false, distance: bestDistance };
}

/** The distinct skills these activities cover, in the order they are listed. */
export function skillCodesForActivities(): string[] {
  return [...new Set(ACTIVITY_SKILLS.map((entry) => entry.skillCode))];
}

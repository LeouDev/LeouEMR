import { matchActivity, type ActivityMatch } from "./activities";

/**
 * The day tracker's arithmetic, kept out of the component so the numbers an
 * agent plans their shift around are covered by tests rather than only by
 * looking at the screen.
 *
 * Everything here is cases per hour. That is a deliberate simplification of
 * how the imported data is scored — Fax and GLP-1 are case_rate skills in
 * skill_references, measured as production weight per case — and it is the
 * right one for this tool: nothing here reaches the database, an agent
 * counts cases and hours as the shift runs, and the per-skill targets are
 * already on a cases-per-hour scale (the Fax ramp in migration 0038 climbs
 * 5.5 to 11, converging on that skill's steady-state target of 11).
 */

/** A block of scheduled time as the agent logged it. */
export interface ActivityBlock {
  id: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Exactly what was scanned or typed — never rewritten by a match. */
  activity: string;
  /** HH:MM, 24-hour. */
  start: string;
  end: string;
  /** Which skill's target these hours are measured against; null when uncounted. */
  skillCode: string | null;
}

/** One logged prior-authorization case. */
export interface LoggedCase {
  id: string;
  date: string;
  caseNumber: string;
  /** Which skill it was worked on, so it lands in the same bucket as its hours. */
  skillCode: string | null;
  decision: "Pend" | "Deny" | "Approved" | "Cancel";
  activeApproval: "Y" | "N";
  cancellationNote: "Y" | "N";
  urgent: "Y" | "N";
  quantityLimit: "Y" | "N";
  loggedAt: string;
}

/**
 * A block longer than this is treated as a reading error rather than a
 * genuine shift. The overnight rule below turns any end-before-start pair
 * into a next-day block, so a misread "1:00 PM" as "1:00 AM" silently
 * becomes thirteen hours and quietly halves the day's rate.
 */
export const MAX_BLOCK_HOURS = 14;

/** `HH:MM` to minutes past midnight, or null if it is not a time. */
export function minutesOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Hours between two `HH:MM` times, crossing midnight when the end is
 * earlier than the start — the shift genuinely does, on a Manila night
 * shift against a US clock.
 *
 * Returns null rather than a number when the result is implausible, so the
 * caller can flag the row instead of quietly banking it.
 */
export function blockHours(start: string, end: string): number | null {
  const from = minutesOfDay(start);
  const to = minutesOfDay(end);
  if (from === null || to === null) return null;

  let minutes = to - from;
  if (minutes < 0) minutes += 24 * 60;
  if (minutes === 0) return 0;

  const hours = minutes / 60;
  return hours > MAX_BLOCK_HOURS ? null : hours;
}

/** Today's date in the viewer's own timezone — not UTC, which is a day off for half a Manila shift. */
export function localDateString(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/* ---------------------------------------------------------------- parsing */

/**
 * `9:05 PM`, `9:05PM`, `21:05` and the `A.M.` the OCR sometimes produces.
 *
 * The meridiem is one atomic group rather than four independently optional
 * pieces (letter, dot, space, M, dot). Independently optional meant a bare
 * "P" or "M" belonging to the NEXT word — "Part D", "Meeting", "Approved" —
 * matched as the current time's meridiem on its own, which both corrupted
 * the time (`to24Hour` rejects an hour above 12 with a meridiem, so a stray
 * "17:00 P" from "Part D" silently vanished) and ate that letter out of the
 * activity name. Requiring the whole "P.M." (or "PM") together, or nothing
 * at all, means a time is never misread just because the next word happens
 * to start with A, P or M.
 */
const TIME_TOKEN = /(\d{1,2}):([0-5]\d)(?:\s*([AaPp])\.?\s*[Mm]\.?)?/g;

/** One token from a scanned line, normalised to 24-hour `HH:MM`. */
export function to24Hour(hour: number, minute: number, meridiem: string | null): string | null {
  if (minute > 59) return null;
  let h = hour;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    const pm = meridiem.toLowerCase() === "p";
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Every time on a line, in order. */
export function timesOnLine(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TIME_TOKEN)) {
    const value = to24Hour(Number(match[1]), Number(match[2]), match[3] ?? null);
    if (value) found.push(value);
  }
  return found;
}

/**
 * The activity name, with the times and calendar furniture taken out.
 *
 * Times are removed by index rather than by `String.replace`, which replaces
 * only the first occurrence — a row scheduled "9:00 AM 9:00 AM" kept one of
 * them in the name.
 */
export function activityNameFrom(text: string): string {
  return text
    .replace(TIME_TOKEN, " ")
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b/gi, " ")
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, " ")
    .replace(/[-–—]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^\d+\s+/, "");
}

export interface ScannedRow {
  /** The text as scanned, kept so a review can check the match against it. */
  raw: string;
  start: string;
  end: string;
  hours: number | null;
  match: ActivityMatch | null;
  /** OCR's own confidence for the line, when the engine reported one. */
  confidence: number | null;
}

/**
 * Turns scanned lines into reviewable rows.
 *
 * Uses the FIRST two times on a line as start and end. A date is not a time
 * token at all — it is slash-separated, not colon-separated — so a leading
 * date column was never actually a hazard here; a trailing Duration column
 * is. An IEX schedule row often reads Activity, Start, Stop, Duration, and
 * taking the last two of those would read Duration as the end time — for a
 * 10:00-11:00 block with a "1:00" duration column, that silently commits an
 * 11:00-to-1:00 block instead of a one-hour one.
 */
export function parseScheduleLines(
  lines: Array<{ text: string; confidence?: number | null }>,
): ScannedRow[] {
  const rows: ScannedRow[] = [];
  for (const line of lines) {
    const text = (line.text ?? "").trim();
    if (!text) continue;

    const times = timesOnLine(text);
    if (times.length < 2) continue;

    const [start, end] = times.slice(0, 2);
    const raw = activityNameFrom(text);
    if (!raw) continue;

    rows.push({
      raw,
      start,
      end,
      hours: blockHours(start, end),
      match: matchActivity(raw),
      confidence: typeof line.confidence === "number" ? line.confidence : null,
    });
  }
  return rows;
}

/* ------------------------------------------------------------ day figures */

export interface SkillTarget {
  code: string;
  name: string;
  /** Cases per hour this skill is being held to today. */
  target: number;
  /** Set when the target came from a ramp stage rather than the steady-state figure. */
  rampStageLabel: string | null;
}

export interface SkillProgress {
  skillCode: string;
  skillName: string;
  hours: number;
  cases: number;
  target: number;
  rampStageLabel: string | null;
  /** Cases this skill's hours expect: hours × target. */
  required: number;
  /** Cases per hour actually achieved, or null with no hours to divide by. */
  pace: number | null;
  /** Whole cases still needed to reach `required`; 0 once it is met. */
  remaining: number;
  met: boolean;
}

export interface DayProgress {
  date: string;
  skills: SkillProgress[];
  totalHours: number;
  totalCases: number;
  /** Hours-weighted across the skills actually worked — the day's real goal. */
  totalRequired: number;
  /** `totalRequired / totalHours`: the blended cases-per-hour the mix demands. */
  blendedTarget: number | null;
  pace: number | null;
  remaining: number;
  met: boolean;
  /** Counted hours that carry no target, so they are excluded from the goal. */
  untargetedHours: number;
  /** Cases logged against no skill, so they count for no target. */
  unattributedCases: number;
}

/**
 * The day, per skill and in total.
 *
 * Cases are bucketed by the skill they were worked on rather than counted
 * against whichever hours happen to share the date. Counting every case
 * against only the qualifying hours — what the original tool did — inflates
 * the rate whenever an agent logs a case during a block that does not count,
 * and it always inflates it in the flattering direction.
 */
export function summarizeDay(
  date: string,
  blocks: ActivityBlock[],
  cases: LoggedCase[],
  targets: Map<string, SkillTarget>,
): DayProgress {
  const dayBlocks = blocks.filter((b) => b.date === date);
  const dayCases = cases.filter((c) => c.date === date);

  const hoursBySkill = new Map<string, number>();
  let untargetedHours = 0;
  for (const block of dayBlocks) {
    const hours = blockHours(block.start, block.end);
    if (hours === null || hours === 0) continue;
    if (!block.skillCode) continue;
    if (!targets.has(block.skillCode)) {
      untargetedHours += hours;
      continue;
    }
    hoursBySkill.set(block.skillCode, (hoursBySkill.get(block.skillCode) ?? 0) + hours);
  }

  const casesBySkill = new Map<string, number>();
  let unattributedCases = 0;
  for (const entry of dayCases) {
    if (!entry.skillCode || !targets.has(entry.skillCode)) {
      unattributedCases++;
      continue;
    }
    casesBySkill.set(entry.skillCode, (casesBySkill.get(entry.skillCode) ?? 0) + 1);
  }

  // Every skill with either hours or cases gets a row: a skill worked with no
  // cases yet is exactly the one an agent needs to see.
  const skillCodes = [...new Set([...hoursBySkill.keys(), ...casesBySkill.keys()])];

  const skills: SkillProgress[] = skillCodes
    .map((code) => {
      const target = targets.get(code)!;
      const hours = hoursBySkill.get(code) ?? 0;
      const caseCount = casesBySkill.get(code) ?? 0;
      // Rounded to six decimal places: hours (minutes/60) times a decimal
      // ramp target lands a hair above an exact integer often enough that
      // Math.ceil below would round a genuine 62 up to a phantom 63 — an
      // agent who has already made the goal would be told they are one
      // case short of it forever.
      const required = Math.round(hours * target.target * 1e6) / 1e6;
      return {
        skillCode: code,
        skillName: target.name,
        hours,
        cases: caseCount,
        target: target.target,
        rampStageLabel: target.rampStageLabel,
        required,
        pace: hours > 0 ? caseCount / hours : null,
        remaining: Math.max(0, Math.ceil(required - caseCount)),
        met: caseCount >= required,
      };
    })
    .sort((a, b) => b.hours - a.hours || a.skillName.localeCompare(b.skillName));

  const totalHours = skills.reduce((sum, s) => sum + s.hours, 0);
  const totalCases = skills.reduce((sum, s) => sum + s.cases, 0);
  // Rounded again: summing several already-rounded per-skill requirements
  // can still land a whole-day total a hair above an integer.
  const totalRequired = Math.round(skills.reduce((sum, s) => sum + s.required, 0) * 1e6) / 1e6;

  return {
    date,
    skills,
    totalHours,
    totalCases,
    totalRequired,
    blendedTarget: totalHours > 0 ? totalRequired / totalHours : null,
    pace: totalHours > 0 ? totalCases / totalHours : null,
    remaining: Math.max(0, Math.ceil(totalRequired - totalCases)),
    met: totalHours > 0 && totalCases >= totalRequired,
    untargetedHours,
    unattributedCases,
  };
}

/** Progress toward the day's goal as a percentage, capped for display at 100. */
export function progressPercent(day: DayProgress): number {
  if (day.totalRequired <= 0) return 0;
  return Math.min(100, (day.totalCases / day.totalRequired) * 100);
}

/* ------------------------------------------------------------------- csv */

/**
 * Quotes a CSV field, and defuses a leading `=`, `+`, `-` or `@`.
 *
 * These files are opened in Excel and loaded into SharePoint, where a case
 * number beginning with `=` is a formula rather than a value. Quoting alone
 * does not stop that.
 */
export function csvField(value: unknown): string {
  const text = String(value ?? "");
  const escaped = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${escaped.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Array<Array<unknown>>): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

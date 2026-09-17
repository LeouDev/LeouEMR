import { csvOf } from "@/lib/csv";

/**
 * The admin dashboard's arithmetic: NPS categories, the stat cards, the
 * filter and the export. Pure, so every rule here is pinned by a test
 * rather than only exercised through a page.
 */

export interface SurveyResponseRow {
  id: string;
  respondentName: string;
  respondentEmail: string;
  submittedAt: string;
  q1Overall: number;
  q2Ease: number;
  q3Findability: number;
  q4Nps: number;
  q5Feedback: string;
}

export type NpsCategory = "promoter" | "passive" | "detractor";

/**
 * The standard NPS bands: 9–10 promote, 7–8 are passive, 0–6 detract.
 *
 * Passives count in the denominator and in neither numerator, which is why
 * the score can be negative and why it is not an average.
 */
export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export interface SurveyStats {
  responses: number;
  /** Mean of 1–5 answers, or null with nothing to average. */
  avgOverall: number | null;
  avgEase: number | null;
  avgFindability: number | null;
  /** Promoters less detractors as a share of all responses, rounded; null with none. */
  nps: number | null;
  promoters: number;
  passives: number;
  detractors: number;
}

export function summarize(rows: SurveyResponseRow[]): SurveyStats {
  const responses = rows.length;
  const counts = { promoter: 0, passive: 0, detractor: 0 };
  for (const row of rows) counts[npsCategory(row.q4Nps)] += 1;

  const mean = (pick: (row: SurveyResponseRow) => number): number | null =>
    responses === 0 ? null : rows.reduce((sum, row) => sum + pick(row), 0) / responses;

  return {
    responses,
    avgOverall: mean((r) => r.q1Overall),
    avgEase: mean((r) => r.q2Ease),
    avgFindability: mean((r) => r.q3Findability),
    nps:
      responses === 0
        ? null
        : Math.round(((counts.promoter - counts.detractor) / responses) * 100),
    promoters: counts.promoter,
    passives: counts.passive,
    detractors: counts.detractor,
  };
}

export interface SurveyFilter {
  /** Matched against the respondent's name, their email and the feedback text. */
  search: string;
  /** Submitted within this many days; null for every date. */
  withinDays: number | null;
}

/**
 * The rows a filter leaves, newest first.
 *
 * The date window counts back from `now` rather than from the newest
 * response, so "last 7 days" means the last seven days and reads as empty
 * when nothing has come in — which is the honest answer, not a bug.
 */
export function filterResponses(
  rows: SurveyResponseRow[],
  filter: SurveyFilter,
  now: Date = new Date(),
): SurveyResponseRow[] {
  const needle = filter.search.trim().toLowerCase();
  const cutoff =
    filter.withinDays === null
      ? null
      : new Date(now.getTime() - filter.withinDays * 24 * 60 * 60 * 1000);

  return rows
    .filter((row) => {
      if (cutoff && new Date(row.submittedAt) < cutoff) return false;
      if (!needle) return true;
      return (
        row.respondentName.toLowerCase().includes(needle) ||
        row.respondentEmail.toLowerCase().includes(needle) ||
        row.q5Feedback.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/** The export's rows: a header, then whatever the filter left. */
export function surveyCsvRows(rows: SurveyResponseRow[]): Array<Array<string | number>> {
  return [
    ["Respondent", "Email", "Submitted", "Overall", "Ease of use", "Finding info", "NPS", "NPS band", "Feedback"],
    ...rows.map((row) => [
      row.respondentName,
      row.respondentEmail,
      row.submittedAt,
      row.q1Overall,
      row.q2Ease,
      row.q3Findability,
      row.q4Nps,
      npsCategory(row.q4Nps),
      row.q5Feedback,
    ]),
  ];
}

export function surveyCsv(rows: SurveyResponseRow[]): string {
  return csvOf(surveyCsvRows(rows));
}

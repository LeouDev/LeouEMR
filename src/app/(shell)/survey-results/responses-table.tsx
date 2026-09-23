"use client";

import { useMemo, useState } from "react";
import { CSV_BOM } from "@/lib/csv-bom";
import { EmptyState } from "@/components/ui";
import {
  filterResponses,
  npsCategory,
  summarize,
  surveyCsv,
  type NpsCategory,
  type SurveyResponseRow,
} from "@/lib/survey/summary";

/**
 * The responses, filtered live, with the stat cards recomputed from
 * whatever the filter left.
 *
 * Filtering in the browser on purpose: one response per account caps this
 * at the size of the roster, so the whole set arrives with the page and
 * search feels instant instead of costing a round trip per keystroke.
 *
 * The export writes exactly the rows on screen — the filter is the
 * selection — through the app's shared `csvOf`, which is also what stops a
 * line of typed feedback beginning "=" from arriving as a formula in
 * whoever opens the file.
 */

const DATE_WINDOWS: Array<{ value: string; label: string; days: number | null }> = [
  { value: "all", label: "All dates", days: null },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
];

/** The NPS bands as the score defines them: the passives and detractors are where the feedback to act on is. */
const NPS_BANDS: Array<{ value: NpsCategory | "all"; label: string }> = [
  { value: "all", label: "All NPS" },
  { value: "promoter", label: "Promoters (9–10)" },
  { value: "passive", label: "Passives (7–8)" },
  { value: "detractor", label: "Detractors (0–6)" },
];

export function ResponsesTable({ rows }: { rows: SurveyResponseRow[] }) {
  const [search, setSearch] = useState("");
  // Not `window`: that name shadows the global for this whole component,
  // and the export below is one `typeof window` guard away from being
  // quietly wrong.
  const [dateWindow, setDateWindow] = useState("all");
  const [npsBand, setNpsBand] = useState<NpsCategory | "all">("all");

  const visible = useMemo(() => {
    const days = DATE_WINDOWS.find((w) => w.value === dateWindow)?.days ?? null;
    return filterResponses(rows, { search, withinDays: days, nps: npsBand === "all" ? null : npsBand });
  }, [rows, search, dateWindow, npsBand]);

  const stats = useMemo(() => summarize(visible), [visible]);

  function exportCsv() {
    const blob = new Blob([CSV_BOM + surveyCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `survey-responses-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="mb-8 grid border-2 border-ink bg-surface sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Responses" value={String(stats.responses)} note="in this view" />
        <Stat
          label="Avg. overall satisfaction"
          value={stats.avgOverall === null ? "—" : stats.avgOverall.toFixed(1)}
          note="out of 5"
        />
        <Stat
          label="Avg. ease of use"
          value={stats.avgEase === null ? "—" : stats.avgEase.toFixed(1)}
          note="out of 5"
        />
        <Stat
          label="NPS score"
          value={stats.nps === null ? "—" : `${stats.nps > 0 ? "+" : ""}${stats.nps}`}
          note={`${stats.promoters} promoters, ${stats.detractors} detractors`}
          last
        />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search respondent or feedback…"
          aria-label="Search respondent or feedback"
          className="w-full max-w-[280px] border-2 border-ink bg-surface px-3 py-2 text-sm text-ink outline-none"
        />
        <select
          value={dateWindow}
          onChange={(event) => setDateWindow(event.target.value)}
          aria-label="Date range"
          className="border-2 border-ink bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none"
        >
          {DATE_WINDOWS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={npsBand}
          onChange={(event) => setNpsBand(event.target.value as NpsCategory | "all")}
          aria-label="NPS band"
          className="border-2 border-ink bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none"
        >
          {NPS_BANDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-sm text-muted">
          {visible.length} of {rows.length} response{rows.length === 1 ? "" : "s"}
        </span>
        <button type="button" onClick={exportCsv} disabled={visible.length === 0} className="btn-secondary px-4 py-2 text-sm">
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto border-2 border-ink bg-surface">
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink">
              {["Respondent", "Submitted", "Overall", "Ease of use", "Finding info", "NPS", "Feedback"].map(
                (label, i) => (
                  <th
                    key={label}
                    className={`px-3 py-3 text-[11px] font-bold tracking-[0.08em] text-ink uppercase ${
                      i === 0 || i === 6 ? "text-left" : "text-right"
                    }`}
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-b-2 border-line last:border-0 hover:bg-cream">
                <td className="px-3 py-3">
                  <span className="font-bold text-ink">{row.respondentName}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{row.respondentEmail}</span>
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap text-muted">
                  {new Date(row.submittedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "Asia/Manila",
                  })}
                </td>
                <Score value={row.q1Overall} />
                <Score value={row.q2Ease} />
                <Score value={row.q3Findability} />
                <td className="px-3 py-3 text-right">
                  <NpsTag score={row.q4Nps} />
                </td>
                <td className="max-w-[340px] px-3 py-3 text-ink">{row.q5Feedback}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <EmptyState
            title={rows.length === 0 ? "No responses yet" : "No responses match your filters"}
            description={
              rows.length === 0
                ? "Answers appear here as people sign in and complete the survey."
                : "Clear the search or widen the date range."
            }
          />
        )}
      </div>
    </>
  );
}

/** A 1–5 answer. Red below the midpoint, since that is the half worth reading. */
function Score({ value }: { value: number }) {
  return (
    <td
      className={`px-3 py-3 text-right font-mono font-bold tabular-nums ${
        value <= 2 ? "text-fail" : value >= 4 ? "text-pass" : "text-ink"
      }`}
    >
      {value}/5
    </td>
  );
}

/** The 0–10 answer in its NPS band: promoters read well, detractors read badly. */
function NpsTag({ score }: { score: number }) {
  const band = npsCategory(score);
  const tone =
    band === "promoter"
      ? "border-pass bg-pass-bg text-pass"
      : band === "detractor"
        ? "border-fail bg-fail-bg text-fail"
        : "border-line bg-cream text-muted";
  return (
    <span
      title={`${band} (${score}/10)`}
      className={`inline-block border-2 px-2 py-0.5 font-mono text-xs font-extrabold tabular-nums ${tone}`}
    >
      {score}
    </span>
  );
}

function Stat({
  label,
  value,
  note,
  last,
}: {
  label: string;
  value: string;
  note: string;
  last?: boolean;
}) {
  return (
    <div className={`border-b-2 border-line px-6 py-5 lg:border-b-0 ${last ? "" : "lg:border-r-2"}`}>
      <p className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase">{label}</p>
      <p className="mt-2 font-mono text-[36px] leading-none font-extrabold tabular-nums text-ink">{value}</p>
      <p className="mt-1.5 text-[13px] text-muted">{note}</p>
    </div>
  );
}

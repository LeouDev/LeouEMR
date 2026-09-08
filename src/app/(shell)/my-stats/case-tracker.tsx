"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { ACTIVITY_SKILLS } from "@/lib/case-tracker/activities";
import { caseLogCsv, eodBody, summaryCsv } from "@/lib/case-tracker/report";
import { resolveTargets, stageFor, STANDARD, type TargetSkill } from "@/lib/case-tracker/targets";
import {
  localDateString,
  progressPercent,
  summarizeDay,
  type ActivityBlock,
  type LoggedCase,
} from "@/lib/case-tracker/tracker";
import { CaseForm, type CaseFormProgress } from "./case-tracker-case-form";
import { ScheduleCard } from "./case-tracker-schedule";
import { CELL, ConfirmDelete, FIELD, HEAD, LABEL, NUM, fmt } from "./case-tracker-ui";

interface TrackerState {
  blocks: ActivityBlock[];
  cases: LoggedCase[];
  /** skillCode -> ramp stage, or STANDARD. Absent means "whatever ramp says today". */
  rampStage: Record<string, number>;
  eod: { yourName: string; tlName: string };
}

const EMPTY: TrackerState = { blocks: [], cases: [], rampStage: {}, eod: { yourName: "", tlName: "" } };

/**
 * The day's work, held in this browser only.
 *
 * Read through useSyncExternalStore rather than copied into state by an
 * effect — the same reason the adherence scan is: the server has no
 * localStorage, so it renders the empty state and React swaps the saved day
 * in on hydration. Seeding useState from storage would hydrate different
 * markup than the server sent.
 *
 * One store per employee id, so two agents signing into the same browser
 * never see each other's cases.
 */
function createStore(key: string) {
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: TrackerState } = { raw: null, value: EMPTY };

  const read = (): TrackerState => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      // Private browsing or storage disabled — the tool still runs, it just
      // will not survive a refresh.
      raw = null;
    }
    if (raw !== cache.raw) {
      let value = EMPTY;
      try {
        value = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<TrackerState>) } : EMPTY;
      } catch {
        value = EMPTY;
      }
      cache = { raw, value };
    }
    return cache.value;
  };

  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    read,
    /** Nothing is saved as far as the server is concerned. */
    serverRead: () => EMPTY,
    /** Returns an error message when the write could not be made. */
    update(fn: (prev: TrackerState) => TrackerState): string | null {
      const next = fn(read());
      let failure: string | null = null;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        failure = "This browser would not save the change — it may be in private mode or out of space.";
      }
      // Cached regardless: refusing to show what the agent just typed because
      // the disk is full would lose the work outright.
      cache = { raw: cache.raw, value: next };
      for (const listener of listeners) listener();
      return failure;
    },
  };
}

/**
 * Today, in the browser's own timezone — resolved once, not re-read live.
 *
 * The server renders its own date and the browser corrects it on hydration,
 * which is what useSyncExternalStore is for. Reading it directly during
 * render would hydrate a different day than the server sent: a Manila shift
 * starting at 00:30 is still the previous day in UTC, so the tracker would
 * open on yesterday for the first eight hours of every night shift.
 *
 * `now()` caches its answer after the first call rather than reading the
 * clock fresh every time React asks for a snapshot. `subscribe` never
 * notifies, so nothing about this store is meant to change after hydration —
 * but React still re-invokes `getSnapshot` on every unrelated re-render to
 * check for tearing, and a wall clock read there is a real clock: the exact
 * moment it crosses midnight, a re-render triggered by something else
 * entirely — logging a case, ticking a checkbox — silently flips the whole
 * tracker to a new, empty day out from under whatever the agent was doing.
 * A working date should change because the agent changed it, the same as it
 * always did in the original tool, which only ever read the date once too.
 */
const clock = {
  subscribe() {
    return () => {};
  },
  resolved: null as string | null,
  now(): string {
    return (clock.resolved ??= localDateString(new Date()));
  },
};

const stores = new Map<string, ReturnType<typeof createStore>>();
function storeFor(key: string) {
  let store = stores.get(key);
  if (!store) {
    store = createStore(key);
    stores.set(key, store);
  }
  return store;
}

const id = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${performance.now()}`;

function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * A personal day tracker: what was scheduled, what was completed, and whether
 * that is on pace for the target each skill carries.
 *
 * Everything is kept in this browser. Nothing here is imported, scored or
 * read by anyone else — an agent's real numbers come from the weekly
 * workbook, and this tool exists so they do not have to wait for it to know
 * where they stand.
 */
export function CaseTracker({
  employeeId,
  employeeName,
  skills,
  today,
}: {
  employeeId: string;
  employeeName: string;
  skills: TargetSkill[];
  /** Resolved on the server so the first paint matches; the picker moves freely after. */
  today: string;
}) {
  const store = storeFor(`pa-case-tracker:${employeeId}`);
  const state = useSyncExternalStore(store.subscribe, store.read, store.serverRead);

  const browserToday = useSyncExternalStore(clock.subscribe, clock.now, () => today);
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const date = chosenDate ?? browserToday;
  const setDate = setChosenDate;
  const [logging, setLogging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  // The controls that raise a notice — Add block, the OCR reader, the EOD
  // form — live in cards well below this one. Without this, a validation
  // message for a control at the bottom of the page renders silently at the
  // top, and nothing on the visible part of the screen changes.
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [notice]);

  const targets = resolveTargets(skills, state.rampStage);
  const day = summarizeDay(date, state.blocks, state.cases, targets);
  const dayCases = state.cases.filter((c) => c.date === date);
  const percent = progressPercent(day);
  const gaugeTone: CaseFormProgress["tone"] =
    day.totalHours === 0 ? "muted" : day.met ? "pass" : percent >= 60 ? "warn" : "fail";

  const apply = (fn: (prev: TrackerState) => TrackerState) => setNotice(store.update(fn));

  /* ---------------------------------------------------------------- export */

  const summaryDates = [
    ...new Set([...state.blocks.map((b) => b.date), ...state.cases.map((c) => c.date)]),
  ].sort();

  const exportSummary = () =>
    download("case_tracker_summary.csv", summaryCsv(summaryDates, state.blocks, state.cases, targets));

  const sendEod = () => {
    const yourName = state.eod.yourName.trim();
    const tlName = state.eod.tlName.trim();
    if (!yourName || !tlName) {
      setNotice("Add your name and your team lead's name before sending.");
      return;
    }
    if (dayCases.length > 0) {
      download(`case_log_${date}.csv`, caseLogCsv(dayCases, targets));
    }
    const readable = new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const mailto = `mailto:?subject=${encodeURIComponent(
      `EOD Report (${readable}) - ${yourName}`,
    )}&body=${encodeURIComponent(eodBody(day, yourName, tlName, readable))}`;
    // The download has to start before navigation, or the browser cancels it.
    window.setTimeout(() => {
      window.location.href = mailto;
    }, 350);
  };

  /* ------------------------------------------------------------------ view */

  const tone = day.totalHours === 0 ? "text-ink" : day.met ? "text-pass" : "text-fail";

  return (
    <section className="space-y-6">
      {notice && (
        <div
          ref={noticeRef}
          role="alert"
          className="flex items-start justify-between gap-3 border-2 border-warn bg-warn-bg px-4 py-3 text-sm text-warn"
        >
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
            className="shrink-0 font-bold text-warn"
          >
            ×
          </button>
        </div>
      )}

      <Card>
        <CardHeader
          title="PA case tracker"
          subtitle="Your own running count for the day — kept in this browser, never imported"
          action={
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className={LABEL} htmlFor="ct-date">
                  Working date
                </label>
                <input
                  id="ct-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={`${FIELD} mt-1.5 font-mono`}
                />
              </div>
              <button type="button" onClick={() => setLogging(true)} className="btn-secondary px-4 py-2 text-sm">
                Log a case
              </button>
            </div>
          }
        />

        <div className="grid gap-px border-b-2 border-ink bg-line sm:grid-cols-4">
          {[
            { label: "Cases logged", value: String(day.totalCases) },
            { label: "Production hours", value: fmt(day.totalHours) },
            { label: "Cases per hour", value: day.pace === null ? "—" : fmt(day.pace) },
            {
              label: "Target for the day",
              value: day.totalRequired === 0 ? "—" : String(Math.ceil(day.totalRequired)),
            },
          ].map((stat) => (
            <div key={stat.label} className="bg-surface px-6 py-4">
              <p className="text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
                {stat.label}
              </p>
              <p
                className={`mt-2 text-[32px] leading-none font-extrabold tabular-nums ${
                  stat.label === "Cases per hour" ? tone : "text-ink"
                }`}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="px-6 py-5">
          <div className="h-3 w-full border-2 border-ink bg-cream">
            <div
              className={`h-full transition-[width] duration-300 ${day.met ? "bg-pass" : percent >= 60 ? "bg-warn" : "bg-fail"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2.5 text-sm text-muted">
            {day.totalHours === 0
              ? "Add the day's scheduled blocks to work out the target."
              : day.met
                ? `On target — ${day.totalCases} of ${Math.ceil(day.totalRequired)} cases, blended goal ${fmt(day.blendedTarget ?? 0)}/hr.`
                : `${day.remaining} more case${day.remaining === 1 ? "" : "s"} to hit ${Math.ceil(day.totalRequired)} — blended goal ${fmt(day.blendedTarget ?? 0)}/hr across today's mix.`}
          </p>
          {(day.untargetedHours > 0 || day.unattributedCases > 0) && (
            <p className="mt-1.5 text-xs text-muted">
              Not counted toward the goal:{" "}
              {day.untargetedHours > 0 && `${fmt(day.untargetedHours)} hrs on activities with no target`}
              {day.untargetedHours > 0 && day.unattributedCases > 0 && ", "}
              {day.unattributedCases > 0 && `${day.unattributedCases} case(s) with no skill`}.
            </p>
          )}
        </div>

        {day.skills.length > 0 && (
          <div className="overflow-x-auto border-t-2 border-ink">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b-2 border-ink bg-cream">
                  <th className={`${HEAD} px-6`}>Skill</th>
                  <th className={HEAD}>Hours</th>
                  <th className={HEAD}>Cases</th>
                  <th className={HEAD}>Target</th>
                  <th className={HEAD}>Needs</th>
                  <th className={HEAD}>Pace</th>
                  <th className={`${HEAD} px-6`}>Still needed</th>
                </tr>
              </thead>
              <tbody>
                {day.skills.map((skill) => (
                  <tr key={skill.skillCode} className="border-b-2 border-line last:border-0">
                    <td className={`${CELL} px-6 font-medium`}>
                      {skill.skillName}
                      {skill.rampStageLabel && (
                        <span className="ml-2 bg-orange-brand-100 px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] text-ink uppercase">
                          Ramp · {skill.rampStageLabel}
                        </span>
                      )}
                    </td>
                    <td className={`${NUM} text-muted`}>{fmt(skill.hours)}</td>
                    <td className={`${NUM} text-ink`}>{skill.cases}</td>
                    <td className={`${NUM} text-muted`}>{skill.target}/hr</td>
                    <td className={`${NUM} text-muted`}>{Math.ceil(skill.required)}</td>
                    <td className={`${NUM} font-semibold ${skill.hours === 0 ? "text-muted" : skill.met ? "text-pass" : "text-fail"}`}>
                      {skill.pace === null ? "—" : fmt(skill.pace)}
                    </td>
                    <td className={`${NUM} px-6 font-semibold ${skill.met ? "text-pass" : "text-ink"}`}>
                      {skill.met ? "met" : skill.remaining}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Targets"
          subtitle="Each skill carries its own cases-per-hour target; pick a ramp week if you are still ramping"
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b-2 border-ink bg-cream">
                <th className={`${HEAD} px-6`}>Skill</th>
                <th className={HEAD}>IEX activity</th>
                <th className={HEAD}>Standard</th>
                <th className={`${HEAD} px-6`}>Target in use</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => {
                const stage = stageFor(skill, state.rampStage);
                const inUse = targets.get(skill.code)!;
                const activities = ACTIVITY_SKILLS.filter((a) => a.skillCode === skill.code);
                return (
                  <tr key={skill.code} className="border-b-2 border-line last:border-0">
                    <td className={`${CELL} px-6 font-medium`}>{skill.name}</td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {activities.map((a) => a.activity).join(", ")}
                    </td>
                    <td className={`${NUM} text-muted`}>{skill.target}/hr</td>
                    <td className="px-6 py-2">
                      {skill.ramp.length === 0 ? (
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                            {inUse.target}/hr
                          </span>
                          {/* Only some skills have a ramp ladder configured. Saying so
                              beats an absent dropdown, which reads as "you are not
                              ramping" to someone who is. */}
                          <span className="text-xs text-muted">no ramp schedule set up</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <select
                            aria-label={`Ramp week for ${skill.name}`}
                            value={stage === null ? STANDARD : stage}
                            onChange={(e) =>
                              apply((prev) => ({
                                ...prev,
                                rampStage: { ...prev.rampStage, [skill.code]: Number(e.target.value) },
                              }))
                            }
                            className={FIELD}
                          >
                            <option value={STANDARD}>Not ramping — {skill.target}/hr</option>
                            {skill.ramp.map((option) => (
                              <option key={option.stage} value={option.stage}>
                                {option.label} — {option.target}/hr
                              </option>
                            ))}
                          </select>
                          <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                            {inUse.target}/hr
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t-2 border-ink px-6 py-3 text-xs text-muted">
          Ramp weeks come from the same schedule the imported data is scored against. Where you have a
          ramp assignment, your current week is already selected.
        </p>
      </Card>

      <ScheduleCard
        date={date}
        blocks={state.blocks}
        targets={targets}
        onNotice={setNotice}
        onAdd={(rows) => apply((prev) => ({ ...prev, blocks: [...prev.blocks, ...rows] }))}
        onRemove={(blockId) =>
          apply((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== blockId) }))
        }
      />

      <Card>
        <CardHeader
          title={`Cases logged — ${date}`}
          subtitle={`${dayCases.length} logged`}
          action={
            <button
              type="button"
              onClick={() => download(`case_log_${date}.csv`, caseLogCsv(dayCases, targets))}
              disabled={dayCases.length === 0}
              className="btn-secondary px-4 py-2 text-sm"
            >
              Export this day
            </button>
          }
        />
        {dayCases.length === 0 ? (
          <EmptyState title="Nothing logged yet" description="Use “Log a case” above as you complete each one." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b-2 border-ink bg-cream">
                  <th className={`${HEAD} px-6`}>PA case</th>
                  <th className={HEAD}>Skill</th>
                  <th className={HEAD}>Decision</th>
                  <th className={HEAD}>Approval</th>
                  <th className={HEAD}>Cancel note</th>
                  <th className={HEAD}>Urgent</th>
                  <th className={HEAD}>Qty limit</th>
                  <th className={HEAD}>Logged</th>
                  <th className={`${HEAD} px-6`} />
                </tr>
              </thead>
              <tbody>
                {dayCases.map((c) => (
                  <tr key={c.id} className="border-b-2 border-line last:border-0">
                    <td className={`${CELL} px-6 font-mono`}>{c.caseNumber}</td>
                    <td className={`${CELL} text-muted`}>
                      {targets.get(c.skillCode ?? "")?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-1 text-[11px] font-bold tracking-[0.08em] uppercase ${
                          c.decision === "Approved"
                            ? "bg-pass-bg text-pass"
                            : c.decision === "Deny"
                              ? "bg-fail-bg text-fail"
                              : c.decision === "Cancel"
                                ? "bg-cream-dark text-muted"
                                : "bg-warn-bg text-warn"
                        }`}
                      >
                        {c.decision}
                      </span>
                    </td>
                    {[c.activeApproval, c.cancellationNote, c.urgent, c.quantityLimit].map((flag, i) => (
                      <td key={i} className={`${NUM} ${flag === "Y" ? "font-semibold text-ink" : "text-muted"}`}>
                        {flag}
                      </td>
                    ))}
                    <td className={`${CELL} font-mono text-xs text-muted`}>{c.loggedAt}</td>
                    <td className="px-6 py-2 text-right">
                      <ConfirmDelete
                        label={`Remove case ${c.caseNumber}`}
                        onConfirm={() =>
                          apply((prev) => ({ ...prev, cases: prev.cases.filter((row) => row.id !== c.id) }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="History"
          subtitle="Every day this browser has recorded"
          action={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exportSummary}
                disabled={summaryDates.length === 0}
                className="btn-secondary px-4 py-2 text-sm"
              >
                Export summary
              </button>
              <button
                type="button"
                onClick={() => download("case_log.csv", caseLogCsv(state.cases, targets))}
                disabled={state.cases.length === 0}
                className="btn-secondary px-4 py-2 text-sm"
              >
                Export all cases
              </button>
            </div>
          }
        />
        {summaryDates.length === 0 ? (
          <EmptyState title="Nothing recorded yet" description="Days appear here once you log blocks or cases." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b-2 border-ink bg-cream">
                  <th className={`${HEAD} px-6`}>Date</th>
                  <th className={HEAD}>Cases</th>
                  <th className={HEAD}>Hours</th>
                  <th className={HEAD}>Cases/hr</th>
                  <th className={HEAD}>Goal</th>
                  <th className={`${HEAD} px-6`}>Result</th>
                </tr>
              </thead>
              <tbody>
                {[...summaryDates].reverse().map((d) => {
                  const summary = summarizeDay(d, state.blocks, state.cases, targets);
                  return (
                    <tr
                      key={d}
                      className={`border-b-2 border-line last:border-0 ${d === date ? "bg-orange-brand-100" : ""}`}
                    >
                      <td className={`${CELL} px-6 font-mono`}>{d}</td>
                      <td className={`${NUM} text-ink`}>{summary.totalCases}</td>
                      <td className={`${NUM} text-muted`}>{fmt(summary.totalHours)}</td>
                      <td className={`${NUM} font-semibold ${summary.totalHours === 0 ? "text-muted" : summary.met ? "text-pass" : "text-fail"}`}>
                        {summary.pace === null ? "—" : fmt(summary.pace)}
                      </td>
                      <td className={`${NUM} text-muted`}>
                        {summary.blendedTarget === null ? "—" : `${fmt(summary.blendedTarget)}/hr`}
                      </td>
                      <td className="px-6 py-2">
                        {summary.totalHours === 0 ? (
                          <span className="text-sm text-muted">—</span>
                        ) : (
                          <span
                            className={`px-2 py-1 text-[11px] font-bold tracking-[0.08em] uppercase ${
                              summary.met ? "bg-pass-bg text-pass" : "bg-fail-bg text-fail"
                            }`}
                          >
                            {summary.met ? "Met" : `${summary.remaining} short`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="End of day email"
          subtitle="Downloads the day's case log, then opens your mail app with the report filled in"
        />
        <div className="flex flex-wrap items-end gap-3 px-6 py-5">
          <div>
            <label className={LABEL} htmlFor="ct-your-name">
              Your name
            </label>
            <input
              id="ct-your-name"
              value={state.eod.yourName}
              placeholder={employeeName}
              onChange={(e) =>
                apply((prev) => ({ ...prev, eod: { ...prev.eod, yourName: e.target.value } }))
              }
              className={`${FIELD} mt-1.5`}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="ct-tl-name">
              Team lead
            </label>
            <input
              id="ct-tl-name"
              value={state.eod.tlName}
              onChange={(e) => apply((prev) => ({ ...prev, eod: { ...prev.eod, tlName: e.target.value } }))}
              className={`${FIELD} mt-1.5`}
            />
          </div>
          <button type="button" onClick={sendEod} className="btn-secondary px-4 py-2 text-sm">
            Prepare email
          </button>
        </div>
        <p className="border-t-2 border-ink px-6 py-3 text-xs text-muted">
          Your mail app cannot attach a file on its own, so the CSV downloads first — attach it before
          sending.
        </p>
      </Card>

      {logging && (
        <CaseForm
          date={date}
          skills={skills.map((s) => ({ code: s.code, name: s.name }))}
          existingNumbers={new Set(dayCases.map((c) => c.caseNumber.toLowerCase()))}
          progress={{
            percent,
            totalCases: day.totalCases,
            target: day.totalRequired === 0 ? null : Math.ceil(day.totalRequired),
            tone: gaugeTone,
          }}
          onClose={() => setLogging(false)}
          onSave={(entry) =>
            apply((prev) => ({
              ...prev,
              cases: [
                ...prev.cases,
                { ...entry, id: id(), loggedAt: new Date().toLocaleTimeString() },
              ],
            }))
          }
        />
      )}
    </section>
  );
}


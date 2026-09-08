"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import type { AdherenceAgentDay } from "@/lib/adherence/parse-pdf";
import { parseAdherenceUpload } from "./actions";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

type Result = { fileName: string; agents: AdherenceAgentDay[] };

/** The key this used before it was namespaced per user — cleared on load, never read. */
const LEGACY_GLOBAL_KEY = "adherence-coding-result";

type SegmentFilter = "unscheduled" | "variance" | "all";

const FILTERS: Array<{ value: SegmentFilter; label: string }> = [
  { value: "unscheduled", label: "Unscheduled only" },
  { value: "variance", label: "With a variance" },
  { value: "all", label: "All segments" },
];

/**
 * The saved scan, held in localStorage so a refresh mid-review does not lose
 * it — coding a fifty-agent report is not a one-sitting task.
 *
 * Keyed per user id rather than one global key: the previous global key
 * meant Team Lead B, opening this page on a shared machine after Team Lead
 * A parsed a roster and walked away without clicking "I'm done" (or simply
 * logged out), saw A's parsed agent names and adherence exceptions render
 * immediately — no upload of their own required. A parsed roster is exactly
 * the kind of data a login boundary is supposed to separate.
 *
 * Read through useSyncExternalStore rather than copied into state by an
 * effect. The server has no localStorage, so it renders nothing and React
 * swaps in the saved scan on hydration; seeding useState from storage would
 * hydrate different markup than the server sent. The parsed value is cached
 * against the raw string because getSnapshot has to return a stable
 * reference — re-parsing on every render would loop.
 */
function createStore(userId: string) {
  const key = `adherence-coding-result:${userId}`;
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: Result | null } = { raw: null, value: null };

  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    read(): Result | null {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        // Private browsing or storage disabled — the page still works.
        raw = null;
      }
      if (raw !== cache.raw) {
        let value: Result | null = null;
        try {
          value = raw ? (JSON.parse(raw) as Result) : null;
        } catch {
          value = null;
        }
        cache = { raw, value };
      }
      return cache.value;
    },

    /** Nothing is saved as far as the server is concerned. */
    serverRead(): Result | null {
      return null;
    },

    write(result: Result | null) {
      try {
        if (result) localStorage.setItem(key, JSON.stringify(result));
        else localStorage.removeItem(key);
      } catch {}
      for (const listener of listeners) listener();
    },
  };
}

const stores = new Map<string, ReturnType<typeof createStore>>();
function storeFor(userId: string) {
  let store = stores.get(userId);
  if (!store) {
    store = createStore(userId);
    stores.set(userId, store);
  }
  return store;
}

export function AdherenceUploader({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const store = storeFor(userId);
  const result = useSyncExternalStore(store.subscribe, store.read, store.serverRead);
  const setResult = store.write;

  // One-time cleanup of the old global key from before this was namespaced —
  // never read, only removed, so a stale cross-user scan left behind on a
  // shared machine doesn't sit there indefinitely.
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_GLOBAL_KEY);
    } catch {}
  }, []);
  /**
   * Unscheduled segments first, because that is what a team lead codes: time
   * the agent spent on something the schedule never asked for. The variance
   * view is still a click away — it answers a different question, about
   * scheduled work that ran early or long.
   */
  const [filter, setFilter] = useState<SegmentFilter>("unscheduled");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    const response = await parseAdherenceUpload(new FormData(form));
    setBusy(false);
    if (response.ok) {
      setResult({ fileName: response.fileName, agents: response.agents });
      form.reset();
    } else {
      setError(response.error);
      setResult(null);
    }
  }

  function handleDone() {
    setResult(null);
    setError(null);
    setResult(null);
  }

  const totalExceptions = result
    ? result.agents.reduce((sum, a) => sum + a.segments.filter((s) => s.variance).length, 0)
    : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Upload" subtitle="A NICE Workforce Management Adherence PDF export" />
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4 border-t-2 border-ink p-6">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Adherence PDF
            </span>
            <input
              type="file"
              name="file"
              accept="application/pdf,.pdf"
              required
              className="block text-sm text-ink file:mr-3 file:border-2 file:border-ink file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:uppercase"
            />
          </label>
          <button type="submit" disabled={busy} className="btn-primary px-5 py-2.5 text-sm">
            {busy ? "Reading…" : "Scan"}
          </button>
          {result && (
            <button
              type="button"
              onClick={handleDone}
              className="border-2 border-ink px-5 py-2.5 text-sm font-semibold tracking-[0.08em] text-ink uppercase transition hover:bg-cream"
            >
              I&rsquo;m done
            </button>
          )}
        </form>
        {error && (
          <p role="alert" className="border-t-2 border-fail bg-fail-bg px-6 py-3 text-sm font-semibold text-fail">
            {error}
          </p>
        )}
      </Card>

      {result &&
        (result.agents.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing to review"
              description="This PDF parsed, but no agent rows were found in it."
            />
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                <span className="font-medium text-ink">{result.fileName}</span> — {result.agents.length} agent
                {result.agents.length === 1 ? "" : "s"}, {totalExceptions} segment
                {totalExceptions === 1 ? "" : "s"} with a variance
              </p>
              <div className="flex border-2 border-ink">
                {FILTERS.map((option, i) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFilter(option.value)}
                    className={`cursor-pointer px-3 py-1.5 text-xs font-semibold ${
                      i > 0 ? "border-l-2 border-ink" : ""
                    } ${
                      filter === option.value
                        ? "bg-ink text-white"
                        : "bg-surface text-ink hover:bg-orange-brand-100"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {result.agents.map((agent) => (
                <AgentTimeline
                  key={`${agent.agentId}|${agent.date ?? ""}`}
                  agent={agent}
                  filter={filter}
                />
              ))}
            </div>
          </>
        ))}
    </div>
  );
}

function AgentTimeline({
  agent,
  filter,
}: {
  agent: AdherenceAgentDay;
  filter: SegmentFilter;
}) {
  // "No scheduled activity" is the definition of an unscheduled segment: the
  // agent was doing something the schedule never asked for.
  const rows =
    filter === "unscheduled"
      ? agent.segments.filter((s) => !s.scheduledActivity)
      : filter === "variance"
        ? agent.segments.filter((s) => s.variance)
        : agent.segments;
  const exceptionCount = agent.segments.filter((s) => s.variance).length;
  const unscheduledCount = agent.segments.filter((s) => !s.scheduledActivity).length;

  return (
    <details className="border-2 border-ink bg-surface" open={rows.length > 0}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-6 py-4">
        <span className="font-medium text-ink">
          {agent.agentName} <span className="ml-2 font-mono text-xs text-muted">{agent.agentId}</span>
        </span>
        <span className="text-xs text-muted">
          {agent.date && `${agent.date} · `}
          {unscheduledCount} unscheduled · {exceptionCount} with a variance · {agent.segments.length}{" "}
          segment{agent.segments.length === 1 ? "" : "s"}
        </span>
      </summary>

      {rows.length === 0 ? (
        <p className="border-t-2 border-line px-6 py-4 text-sm text-muted">
          No {filter === "unscheduled" ? "unscheduled segments" : filter === "variance" ? "segments with a variance" : "segments"} for this agent.
        </p>
      ) : (
        <div className="overflow-x-auto border-t-2 border-ink">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink bg-cream">
                <th className={`${HEAD} px-6`}>Segment</th>
                <th className={HEAD}>Scheduled activity</th>
                <th className={HEAD}>Actual activity</th>
                <th className={`${HEAD} px-6`}>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const segment =
                  row.scheduledFrom && row.scheduledTo
                    ? `${row.scheduledFrom} – ${row.scheduledTo}`
                    : row.actualFrom && row.actualTo
                      ? `${row.actualFrom} – ${row.actualTo}`
                      : "—";
                return (
                  <tr key={i} className="border-b-2 border-line last:border-0">
                    <td className="px-6 py-2.5 font-mono text-xs whitespace-nowrap text-ink">
                      {segment}
                      {!row.scheduledFrom && (
                        <span className="ml-2 text-[10px] text-muted uppercase">unscheduled</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted">{row.scheduledActivity ?? "—"}</td>
                    <td className="px-3 py-2.5 font-medium text-ink">{row.actualActivity ?? "—"}</td>
                    <td className="px-6 py-2.5 text-xs text-muted">{row.variance ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

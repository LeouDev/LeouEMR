"use client";

import { useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import type { AdherenceAgentDay } from "@/lib/adherence/parse-pdf";
import { parseAdherenceUpload } from "./actions";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

export function AdherenceUploader() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fileName: string; agents: AdherenceAgentDay[] } | null>(null);
  const [onlyExceptions, setOnlyExceptions] = useState(true);

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
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={onlyExceptions}
                  onChange={(e) => setOnlyExceptions(e.target.checked)}
                />
                Only segments with a variance
              </label>
            </div>

            <div className="space-y-4">
              {result.agents.map((agent) => (
                <AgentTimeline
                  key={`${agent.agentId}|${agent.date ?? ""}`}
                  agent={agent}
                  onlyExceptions={onlyExceptions}
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
  onlyExceptions,
}: {
  agent: AdherenceAgentDay;
  onlyExceptions: boolean;
}) {
  const rows = onlyExceptions ? agent.segments.filter((s) => s.variance) : agent.segments;
  const exceptionCount = agent.segments.filter((s) => s.variance).length;

  return (
    <details className="border-2 border-ink bg-surface" open={exceptionCount > 0}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-6 py-4">
        <span className="font-medium text-ink">
          {agent.agentName} <span className="ml-2 font-mono text-xs text-muted">{agent.agentId}</span>
        </span>
        <span className="text-xs text-muted">
          {agent.date && `${agent.date} · `}
          {exceptionCount} of {agent.segments.length} segment{agent.segments.length === 1 ? "" : "s"} with a
          variance
        </span>
      </summary>

      {rows.length === 0 ? (
        <p className="border-t-2 border-line px-6 py-4 text-sm text-muted">
          No segments {onlyExceptions ? "with a variance" : "found"} for this agent.
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

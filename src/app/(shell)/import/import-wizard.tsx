"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { previewImport, runImport, type CommitResponse, type PreviewResult } from "./actions";

function describeTransportFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/body exceeded|413|too large/i.test(message)) {
    return "The server rejected the upload as too large. Raise serverActions.bodySizeLimit in next.config.ts.";
  }
  return `The upload did not reach the server: ${message}`;
}

export function ImportWizard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<CommitResponse["summary"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"analyzing" | "importing" | null>(null);

  function formData(): FormData | null {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first");
      return null;
    }
    const data = new FormData();
    data.set("file", file);
    return data;
  }

  async function analyze() {
    const data = formData();
    if (!data) return;

    setBusy("analyzing");
    setError(null);
    setResult(null);

    try {
      const response = await previewImport(data);
      if (response.ok) setPreview(response);
      else {
        setPreview(null);
        setError(response.error);
      }
    } catch (cause) {
      // A rejected request (an oversized body, a dropped connection) throws
      // rather than returning, and without this the UI would sit on
      // "Analyzing…" forever with no explanation.
      setPreview(null);
      setError(describeTransportFailure(cause));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    const data = formData();
    if (!data) return;

    setBusy("importing");
    setError(null);

    try {
      const response = await runImport(data);
      if (response.ok) {
        setResult(response.summary ?? null);
        setPreview(null);
        router.refresh();
      } else {
        setError(response.error ?? "Import failed");
      }
    } catch (cause) {
      setError(describeTransportFailure(cause));
    } finally {
      setBusy(null);
    }
  }

  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = preview?.issues.filter((i) => i.severity === "warning") ?? [];

  return (
    <div className="space-y-6">
      <div className="overflow-hidden border-2 border-ink bg-surface">
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-ink">Upload workbook</h2>
          <p className="mt-0.5 text-sm text-muted">
            .xlsx, .xls or .csv. Nothing is written until you review the analysis and confirm.
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              setFileName(e.target.files?.[0]?.name ?? null);
              setPreview(null);
              setResult(null);
              setError(null);
            }}
            className="block w-full text-sm text-ink file:mr-3 file: file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-navy-900"
          />

          {fileName && <p className="text-sm text-muted">Selected: {fileName}</p>}

          {error && (
            <p role="alert" className="bg-fail-bg px-3 py-2 text-sm text-fail">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={analyze}
              disabled={busy !== null}
              className="border border-line px-4 py-2 text-sm font-semibold text-ink transition hover:border-navy disabled:opacity-50"
            >
              {busy === "analyzing" ? "Analyzing…" : "Analyze"}
            </button>

            {preview && (
              <button
                type="button"
                onClick={commit}
                disabled={busy !== null}
                className="btn-primary px-5 py-3 text-sm"
              >
                {busy === "importing" ? "Importing…" : `Import ${preview.metricCount} metrics`}
              </button>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <div className="overflow-hidden border-2 border-ink bg-surface">
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-base font-semibold text-ink">Analysis</h2>
            <p className="mt-0.5 text-sm text-muted">
              Review before importing — nothing has been written yet
            </p>
          </div>

          <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
            <Figure label="Weeks" value={preview.weeks.length} />
            <Figure label="Employees" value={preview.employeeCount} />
            <Figure label="Metrics" value={preview.metricCount} />
          </div>

          <div className="border-t border-line px-6 py-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">Sheets</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-1.5 font-medium text-muted">Sheet</th>
                  <th className="py-1.5 font-medium text-muted">Read</th>
                  <th className="py-1.5 font-medium text-muted">Used</th>
                  <th className="py-1.5 font-medium text-muted">Skipped</th>
                </tr>
              </thead>
              <tbody>
                {preview.sheets.map((sheet) => (
                  <tr key={sheet.sheet} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 text-ink">{sheet.sheet}</td>
                    <td className="py-1.5 font-mono tabular-nums text-muted">{sheet.rowsRead}</td>
                    <td className="py-1.5 font-mono tabular-nums text-pass">{sheet.rowsUsed}</td>
                    <td className="py-1.5 font-mono tabular-nums text-muted">
                      {sheet.rowsSkipped}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {preview.unrecognizedSheets.length > 0 && (
              <p className="mt-3 text-xs text-muted">
                Ignored sheets: {preview.unrecognizedSheets.join(", ")}
              </p>
            )}
          </div>

          {(errors.length > 0 || warnings.length > 0) && (
            <div className="border-t border-line px-6 py-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">Validation</h3>
              <ul className="space-y-1.5 text-sm">
                {errors.map((issue, index) => (
                  <li key={`e${index}`} className="flex gap-2">
                    <span className="font-semibold text-fail">Error</span>
                    <span className="text-ink">
                      {issue.sheet}: {issue.message}
                      {issue.count > 0 && ` (${issue.count} rows)`}
                    </span>
                  </li>
                ))}
                {warnings.map((issue, index) => (
                  <li key={`w${index}`} className="flex gap-2">
                    <span className="font-semibold text-warn">Warning</span>
                    <span className="text-ink">
                      {issue.sheet}: {issue.message}
                      {issue.count > 0 && ` (${issue.count} rows)`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">
                Skipped rows are excluded from the import; everything else is imported normally.
              </p>
            </div>
          )}

          <div className="border-t border-line px-6 py-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">Metrics by KPI</h3>
            <div className="flex flex-wrap gap-2">
              {preview.metricsByKpi.map((entry) => (
                <span
                  key={entry.kpiCode}
                  className="bg-cream px-3 py-1 text-xs font-medium text-ink"
                >
                  {entry.kpiCode}: {entry.count}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Weeks: {preview.weeks.join(", ")}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="overflow-hidden border border-pass/30 bg-pass-bg/40">
          <div className="px-6 py-5">
            <h2 className="text-base font-semibold text-ink">Import complete</h2>
            <ul className="mt-2 space-y-1 text-sm text-ink">
              <li>{result.metricsWritten} weekly metrics written</li>
              <li>
                {result.employeesCreated} employees created, {result.employeesUpdated} updated
              </li>
              <li>
                {result.issuesOpened} action items opened, {result.issuesUpdated} updated
              </li>
              <li>Weeks: {result.weeks.join(", ")}</li>
              {result.issuesCorrected > 0 && (
                <li className="text-warn">
                  {result.issuesCorrected} action item{result.issuesCorrected === 1 ? "" : "s"} rebuilt —
                  a previously-imported week&rsquo;s data changed since it was first evaluated
                </li>
              )}
              {result.issuesFlagged > 0 && (
                <li className="text-warn">
                  {result.issuesFlagged} action item{result.issuesFlagged === 1 ? "" : "s"} have a
                  since-corrected week but already have RCA/plan work — see the audit log to review
                </li>
              )}
              {result.metricsSkippedNoKpi.length > 0 && (
                <li className="text-warn">
                  Skipped, no matching KPI configured: {result.metricsSkippedNoKpi.join(", ")}
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-line bg-cream/60 p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

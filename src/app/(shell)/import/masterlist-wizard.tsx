"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createUploadTicket } from "./actions";
import {
  previewMasterlist,
  runMasterlistImport,
  type MasterlistCommitResponse,
  type MasterlistPreviewResult,
} from "./masterlist-actions";

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function MasterlistWizard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(currentMonthValue());
  const [fileName, setFileName] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<MasterlistPreviewResult | null>(null);
  const [result, setResult] = useState<MasterlistCommitResponse["summary"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"uploading" | "analyzing" | "importing" | null>(null);

  async function uploadSelectedFile(): Promise<{ path: string; name: string } | null> {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first");
      return null;
    }
    if (!month) {
      setError("Choose the month this masterlist is for");
      return null;
    }

    setBusy("uploading");
    try {
      const ticket = await createUploadTicket(file.name, file.size);
      if (!ticket.ok) {
        setError(ticket.error);
        return null;
      }

      const { error: uploadError } = await createSupabaseBrowserClient()
        .storage.from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file);
      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`);
        return null;
      }

      return { path: ticket.path, name: file.name };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function analyze() {
    setError(null);
    setResult(null);
    setPreview(null);
    setStoragePath(null);

    const uploaded = await uploadSelectedFile();
    if (!uploaded) return;

    setBusy("analyzing");
    try {
      const response = await previewMasterlist(uploaded.path, uploaded.name, `${month}-01`);
      if (response.ok) {
        setPreview(response);
        setStoragePath(uploaded.path);
      } else {
        setPreview(null);
        setError(response.error);
      }
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!storagePath || !fileName) return;

    setBusy("importing");
    setError(null);

    try {
      const response = await runMasterlistImport(storagePath, fileName, `${month}-01`);
      if (response.ok) {
        setResult(response.summary ?? null);
        setPreview(null);
        setStoragePath(null);
        router.refresh();
      } else {
        setError(response.error ?? "Import failed");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
          <h2 className="text-base font-semibold text-ink">Upload monthly masterlist</h2>
          <p className="mt-0.5 text-sm text-muted">
            A complete roster for one month — Agent EID, Supervisor, Manager and Site. Replaces that
            month&apos;s org structure and closes out anyone active last month who is missing from this
            file. Nothing is written until you review the analysis and confirm.
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium tracking-wide text-muted uppercase">Month</span>
              <input
                type="month"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setStoragePath(null);
                  setPreview(null);
                  setResult(null);
                  setError(null);
                }}
                className="border border-line px-3 py-2 text-sm text-ink"
              />
            </label>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                setFileName(e.target.files?.[0]?.name ?? null);
                setStoragePath(null);
                setPreview(null);
                setResult(null);
                setError(null);
              }}
              className="block flex-1 text-sm text-ink file:mr-3 file: file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-navy-900"
            />
          </div>

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
              {busy === "uploading" ? "Uploading…" : busy === "analyzing" ? "Analyzing…" : "Analyze"}
            </button>

            {preview && (
              <button
                type="button"
                onClick={commit}
                disabled={busy !== null}
                className="btn-primary px-5 py-3 text-sm"
              >
                {busy === "importing"
                  ? "Importing…"
                  : `Import ${preview.matchedCount} agents for ${preview.monthLabel}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <div className="overflow-hidden border-2 border-ink bg-surface">
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-base font-semibold text-ink">Analysis — {preview.monthLabel}</h2>
            <p className="mt-0.5 text-sm text-muted">Review before importing — nothing has been written yet</p>
          </div>

          <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
            <Figure label="Rows read" value={preview.rowsRead} />
            <Figure label="Matched agents" value={preview.matchedCount} />
            <Figure label="Would attrite" value={preview.missingEids.length} />
          </div>

          {(errors.length > 0 || warnings.length > 0) && (
            <div className="border-t border-line px-6 py-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">Validation</h3>
              <ul className="space-y-1.5 text-sm">
                {errors.map((issue, index) => (
                  <li key={`e${index}`} className="flex gap-2">
                    <span className="font-semibold text-fail">Error</span>
                    <span className="text-ink">
                      {issue.message}
                      {issue.count > 0 && ` (${issue.count} rows)`}
                    </span>
                  </li>
                ))}
                {warnings.map((issue, index) => (
                  <li key={`w${index}`} className="flex gap-2">
                    <span className="font-semibold text-warn">Warning</span>
                    <span className="text-ink">
                      {issue.message}
                      {issue.count > 0 && ` (${issue.count} rows)`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.unknownEids.length > 0 && (
            <div className="border-t border-line px-6 py-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">
                Unknown EIDs ({preview.unknownEids.length})
              </h3>
              <p className="mb-2 text-xs text-muted">
                Don&apos;t match any existing employee — these rows are skipped, not created.
              </p>
              <p className="font-mono text-xs text-ink">{preview.unknownEids.join(", ")}</p>
            </div>
          )}

          <div className="border-t border-line px-6 py-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">
              Would mark attrited ({preview.missingEids.length})
            </h3>
            <p className="mb-2 text-xs text-muted">
              Active as of the day before {preview.monthLabel} and missing from this file — their
              assignment will be closed out, no new interval opened. If any of these should still be
              active, add them back to the file before importing.
            </p>
            {preview.missingEids.length === 0 ? (
              <p className="text-sm text-muted">None — every previously active agent is accounted for.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                {preview.missingEids.map((e) => (
                  <li key={e.eid} className="flex gap-2">
                    <span className="font-mono text-muted">{e.eid}</span>
                    <span className="text-ink">{e.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="overflow-hidden border border-pass/30 bg-pass-bg/40">
          <div className="px-6 py-5">
            <h2 className="text-base font-semibold text-ink">Import complete — {result.monthLabel}</h2>
            <ul className="mt-2 space-y-1 text-sm text-ink">
              <li>{result.agentsWritten} agents&apos; org structure written</li>
              <li>{result.attritedClosed.length} agents closed out as attrited</li>
              {result.unknownEids.length > 0 && (
                <li className="text-warn">
                  {result.unknownEids.length} unknown EID{result.unknownEids.length === 1 ? "" : "s"} skipped:{" "}
                  {result.unknownEids.join(", ")}
                </li>
              )}
            </ul>
            {result.attritedClosed.length > 0 && (
              <details className="mt-3 text-sm text-ink">
                <summary className="cursor-pointer font-medium">Show attrited agents</summary>
                <ul className="mt-2 space-y-1">
                  {result.attritedClosed.map((e) => (
                    <li key={e.eid} className="flex gap-2">
                      <span className="font-mono text-muted">{e.eid}</span>
                      <span>{e.name}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
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

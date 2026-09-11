"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { CACHE_TAG, invalidateCache } from "@/lib/cache";
import { importBatches } from "@/lib/db/schema";
import { commitMasterlist, diffMasterlist, resolveMasterlistMonth } from "@/lib/import-pipeline/masterlist-commit";
import { parseMasterlistBuffer, type MasterlistParseResult } from "@/lib/import-pipeline/masterlist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { downloadUpload } from "./actions";

// Mirrors actions.ts's own BUCKET — kept private there because a "use server"
// module may only export async functions, so a shared constant can't cross
// the boundary; the literal itself is unlikely to ever change.
const BUCKET = "workbook-imports";

export interface MasterlistPreviewResult {
  ok: true;
  fileName: string;
  monthLabel: string;
  rowsRead: number;
  rowCount: number;
  issues: MasterlistParseResult["issues"];
  unknownEids: string[];
  missingEids: Array<{ eid: string; name: string }>;
  matchedCount: number;
}

export type MasterlistPreviewResponse = MasterlistPreviewResult | { ok: false; error: string };

/** Parses and diffs against the database without writing anything, so an admin sees who this would mark attrited before committing. */
export async function previewMasterlist(
  storagePath: string,
  fileName: string,
  monthStart: string,
): Promise<MasterlistPreviewResponse> {
  const upload = await downloadUpload(storagePath);
  if (!upload.ok) return { ok: false, error: upload.error };

  let parsed: MasterlistParseResult;
  try {
    parsed = parseMasterlistBuffer(upload.buffer);
  } catch (error) {
    return { ok: false, error: `Could not read the workbook: ${(error as Error).message}` };
  }

  const errorCount = parsed.issues.filter((i) => i.severity === "error").length;
  if (parsed.rows.length === 0 && errorCount === 0) {
    return { ok: false, error: "No rows found in this file" };
  }

  const { label } = resolveMasterlistMonth(monthStart);
  const diff = await diffMasterlist(parsed.rows, monthStart);

  return {
    ok: true,
    fileName,
    monthLabel: label,
    rowsRead: parsed.rowsRead,
    rowCount: parsed.rows.length,
    issues: parsed.issues,
    unknownEids: diff.unknownEids,
    missingEids: diff.missingEids,
    matchedCount: diff.matchedCount,
  };
}

export interface MasterlistCommitResponse {
  ok: boolean;
  error?: string;
  summary?: {
    monthLabel: string;
    agentsWritten: number;
    unknownEids: string[];
    attritedClosed: Array<{ eid: string; name: string }>;
    issuesClosed: number;
    reactivated: number;
  };
}

export async function runMasterlistImport(
  storagePath: string,
  fileName: string,
  monthStart: string,
): Promise<MasterlistCommitResponse> {
  const upload = await downloadUpload(storagePath);
  if (!upload.ok) return { ok: false, error: upload.error };

  let parsed: MasterlistParseResult;
  try {
    parsed = parseMasterlistBuffer(upload.buffer);
  } catch (error) {
    return { ok: false, error: `Could not read the workbook: ${(error as Error).message}` };
  }

  if (parsed.rows.length === 0) {
    return { ok: false, error: "No usable rows found in this masterlist" };
  }

  const { start, end, label } = resolveMasterlistMonth(monthStart);

  const [batch] = await db
    .insert(importBatches)
    .values({
      fileName,
      uploadedBy: upload.user.id,
      status: "validated",
      // monthStart/monthEnd are what the weekly import reads back to hold
      // this month authoritative (loadMasterlistMonths in commit.ts).
      validationSummary: { kind: "masterlist", month: label, monthStart: start, monthEnd: end, issues: parsed.issues },
    })
    .returning();

  try {
    const summary = await commitMasterlist(parsed.rows, monthStart, batch.id, upload.user.id);
    await db
      .update(importBatches)
      .set({ status: "committed", rowCounts: { agents: summary.agentsWritten, attrited: summary.attritedClosed.length } })
      .where(eq(importBatches.id, batch.id));
    // Assignments feed the period-owner roll-ups, which read alongside the
    // cached aggregates; evicting the import tag keeps the two in step. The
    // attrition pass closes open work and changes who counts, so the issue
    // and EWS figures go too.
    invalidateCache(CACHE_TAG.imports, CACHE_TAG.issues, CACHE_TAG.ews);
    revalidatePath("/import");
    revalidatePath("/dashboard");
    revalidatePath("/analytics");
    return { ok: true, summary: { monthLabel: label, ...summary } };
  } catch (error) {
    await db
      .update(importBatches)
      .set({ status: "failed", validationSummary: { error: (error as Error).message } })
      .where(eq(importBatches.id, batch.id));
    return { ok: false, error: `Import failed: ${(error as Error).message}` };
  } finally {
    const admin = createSupabaseAdminClient();
    await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
  }
}

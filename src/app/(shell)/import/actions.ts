"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { importBatches } from "@/lib/db/schema";
import { commitImport } from "@/lib/import-pipeline/commit";
import { parseWorkbookBuffer } from "@/lib/import-pipeline/parse-workbook";
import { loadRampTargets, loadSkillMetrics } from "@/lib/import-pipeline/par-scoring";
import type { ParseResult } from "@/lib/import-pipeline/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = [".xlsx", ".xls", ".csv"];

/**
 * A real weekly-plus-history workbook can run to several months of data —
 * one recent export ran 7.6 MB across 14 weeks. Vercel's Serverless
 * Functions hard-cap a request body at 4.5 MB regardless of any
 * application-level setting (see next.config.ts's old bodySizeLimit, which
 * only ever controlled Next's own ceiling, not the platform's), so the file
 * never goes through a server action body at all: the browser uploads it
 * straight to this private Storage bucket via a signed URL, and the actions
 * below only ever handle a path string.
 */
const BUCKET = "workbook-imports";

let bucketReady: Promise<void> | null = null;

/** Idempotent and cheap to call every time — cached per warm instance, not persisted. */
function ensureBucket(admin: ReturnType<typeof createSupabaseAdminClient>): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { data } = await admin.storage.getBucket(BUCKET);
      if (data) return;
      const { error } = await admin.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: MAX_BYTES,
      });
      if (error && !/already exists/i.test(error.message)) {
        bucketReady = null; // let the next call retry rather than caching a failure forever
        throw error;
      }
    })();
  }
  return bucketReady;
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false as const, error: "Not signed in" };
  if (user.role !== "admin") return { ok: false as const, error: "Only administrators can import data" };
  return { ok: true as const, user };
}

export type UploadTicketResponse =
  | { ok: true; bucket: string; path: string; token: string }
  | { ok: false; error: string };

/** Issues a one-time signed URL the browser can upload directly to, bypassing the server entirely. */
export async function createUploadTicket(fileName: string, fileSize: number): Promise<UploadTicketResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  if (fileSize <= 0) return { ok: false, error: "Choose a file to import" };
  if (fileSize > MAX_BYTES) return { ok: false, error: `File is larger than ${MAX_BYTES / 1024 / 1024} MB` };

  const lower = fileName.toLowerCase();
  if (!ALLOWED.some((ext) => lower.endsWith(ext))) {
    return { ok: false, error: `Unsupported file type — use ${ALLOWED.join(", ")}` };
  }

  const admin = createSupabaseAdminClient();
  try {
    await ensureBucket(admin);
  } catch (error) {
    return { ok: false, error: `Could not prepare storage: ${(error as Error).message}` };
  }

  const path = `${auth.user.id}/${randomUUID()}-${fileName}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return { ok: false, error: `Could not start the upload: ${error?.message ?? "unknown error"}` };
  }

  return { ok: true, bucket: BUCKET, path: data.path, token: data.token };
}

export interface PreviewResult {
  ok: true;
  fileName: string;
  weeks: string[];
  employeeCount: number;
  metricCount: number;
  sheets: ParseResult["sheets"];
  issues: ParseResult["issues"];
  unrecognizedSheets: string[];
  metricsByKpi: Array<{ kpiCode: string; count: number }>;
}

export type PreviewResponse = PreviewResult | { ok: false; error: string };

type DownloadedUpload =
  | { ok: false; error: string }
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; buffer: Buffer };

/** Pulls the already-uploaded workbook back down from Storage, server-side — no size limit applies to an outbound fetch the way it does to an inbound request body. */
async function downloadUpload(storagePath: string): Promise<DownloadedUpload> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    return { ok: false, error: `Could not read the uploaded file: ${error?.message ?? "not found"}` };
  }

  return { ok: true, user: auth.user, buffer: Buffer.from(await data.arrayBuffer()) };
}

/** Parses and validates without writing anything, so problems surface before import. */
export async function previewImport(storagePath: string, fileName: string): Promise<PreviewResponse> {
  const upload = await downloadUpload(storagePath);
  if (!upload.ok) return { ok: false, error: upload.error };

  let parsed: ParseResult;
  try {
    const [skillMetrics, rampTargets] = await Promise.all([loadSkillMetrics(), loadRampTargets()]);
    parsed = parseWorkbookBuffer(upload.buffer, skillMetrics, rampTargets);
  } catch (error) {
    return { ok: false, error: `Could not read the workbook: ${(error as Error).message}` };
  }

  const byKpi = new Map<string, number>();
  for (const metric of parsed.metrics) {
    byKpi.set(metric.kpiCode, (byKpi.get(metric.kpiCode) ?? 0) + 1);
  }

  return {
    ok: true,
    fileName,
    weeks: parsed.weeks,
    employeeCount: parsed.employees.length,
    metricCount: parsed.metrics.length,
    sheets: parsed.sheets,
    issues: parsed.issues,
    unrecognizedSheets: parsed.unrecognizedSheets,
    metricsByKpi: [...byKpi.entries()].map(([kpiCode, count]) => ({ kpiCode, count })),
  };
}

export interface CommitResponse {
  ok: boolean;
  error?: string;
  summary?: {
    employeesCreated: number;
    employeesUpdated: number;
    metricsWritten: number;
    issuesOpened: number;
    issuesUpdated: number;
    issuesCorrected: number;
    issuesFlagged: number;
    weeks: string[];
    metricsSkippedNoKpi: string[];
  };
}

export async function runImport(storagePath: string, fileName: string): Promise<CommitResponse> {
  const upload = await downloadUpload(storagePath);
  if (!upload.ok) return { ok: false, error: upload.error };

  let parsed: ParseResult;
  try {
    const [skillMetrics, rampTargets] = await Promise.all([loadSkillMetrics(), loadRampTargets()]);
    parsed = parseWorkbookBuffer(upload.buffer, skillMetrics, rampTargets);
  } catch (error) {
    return { ok: false, error: `Could not read the workbook: ${(error as Error).message}` };
  }

  if (parsed.metrics.length === 0) {
    return { ok: false, error: "No usable metrics found in this workbook" };
  }

  const [batch] = await db
    .insert(importBatches)
    .values({
      fileName,
      uploadedBy: upload.user.id,
      status: "validated",
      validationSummary: { issues: parsed.issues, sheets: parsed.sheets },
    })
    .returning();

  try {
    const summary = await commitImport(parsed, { importBatchId: batch.id });
    revalidatePath("/import");
    revalidatePath("/dashboard");
    return { ok: true, summary };
  } catch (error) {
    await db
      .update(importBatches)
      .set({ status: "failed", validationSummary: { error: (error as Error).message } })
      .where(eq(importBatches.id, batch.id));
    return { ok: false, error: `Import failed: ${(error as Error).message}` };
  } finally {
    // Best-effort: an orphaned upload just sits in storage, it doesn't corrupt anything.
    const admin = createSupabaseAdminClient();
    await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
  }
}

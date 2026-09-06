"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { importBatches } from "@/lib/db/schema";
import { commitImport } from "@/lib/import-pipeline/commit";
import { parseWorkbookBuffer } from "@/lib/import-pipeline/parse-workbook";
import { loadSkillMetrics } from "@/lib/import-pipeline/par-scoring";
import type { ParseResult } from "@/lib/import-pipeline/types";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = [".xlsx", ".xls", ".csv"];

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

type UploadCheck =
  | { ok: false; error: string }
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; file: File };

async function readUpload(formData: FormData): Promise<UploadCheck> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (user.role !== "admin") return { ok: false, error: "Only administrators can import data" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to import" };
  }
  if (file.size > MAX_BYTES) return { ok: false, error: "File is larger than 25 MB" };

  const lower = file.name.toLowerCase();
  if (!ALLOWED.some((ext) => lower.endsWith(ext))) {
    return { ok: false, error: `Unsupported file type — use ${ALLOWED.join(", ")}` };
  }

  return { ok: true, user, file };
}

/** Parses and validates without writing anything, so problems surface before import. */
export async function previewImport(formData: FormData): Promise<PreviewResponse> {
  const upload = await readUpload(formData);
  if (!upload.ok) return { ok: false, error: upload.error };

  let parsed: ParseResult;
  try {
    parsed = parseWorkbookBuffer(
      Buffer.from(await upload.file.arrayBuffer()),
      await loadSkillMetrics(),
    );
  } catch (error) {
    return { ok: false, error: `Could not read the workbook: ${(error as Error).message}` };
  }

  const byKpi = new Map<string, number>();
  for (const metric of parsed.metrics) {
    byKpi.set(metric.kpiCode, (byKpi.get(metric.kpiCode) ?? 0) + 1);
  }

  return {
    ok: true,
    fileName: upload.file.name,
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
    weeks: string[];
    metricsSkippedNoKpi: string[];
  };
}

export async function runImport(formData: FormData): Promise<CommitResponse> {
  const upload = await readUpload(formData);
  if (!upload.ok) return { ok: false, error: upload.error };

  let parsed: ParseResult;
  try {
    parsed = parseWorkbookBuffer(
      Buffer.from(await upload.file.arrayBuffer()),
      await loadSkillMetrics(),
    );
  } catch (error) {
    return { ok: false, error: `Could not read the workbook: ${(error as Error).message}` };
  }

  if (parsed.metrics.length === 0) {
    return { ok: false, error: "No usable metrics found in this workbook" };
  }

  const [batch] = await db
    .insert(importBatches)
    .values({
      fileName: upload.file.name,
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
  }
}

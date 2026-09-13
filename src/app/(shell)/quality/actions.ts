"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAuditQuality } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { auditLog, qaAuditResults, qaAudits, qaForms } from "@/lib/db/schema";
import { qaFormFromRow } from "@/lib/quality/forms";
import { NOT_A_LEADER, OUT_OF_SCOPE } from "@/lib/quality/messages";
import { concatRemarks, findingRows, markKeys, scoreAudit, stepsOf, type QaMarks } from "@/lib/quality/scoring";
import { resolveScopedIds } from "@/lib/queries/performance";

export type SubmitAuditResult = { ok: true; auditId: string } | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const submitSchema = z.object({
  agentId: z.string().uuid(),
  formKey: z.string().trim().min(1).max(40),
  auditDate: z.string().regex(ISO_DATE, "Enter the audit date"),
  headerValues: z.record(z.string().max(64), z.string().trim().max(500)).default({}),
  marks: z.record(z.string().max(200), z.enum(["pass", "fail"])).default({}),
  remarks: z.record(z.string().max(200), z.string().trim().max(2000)).default({}),
});

/**
 * Files a completed audit.
 *
 * The score is computed here from the stored form, never taken from the
 * page: the stepper's live score is a preview of exactly this. Marks for
 * attributes the form does not have are dropped rather than refused — a
 * form edited mid-audit should lose a stale mark, not the whole audit.
 */
export async function submitAudit(input: unknown): Promise<SubmitAuditResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Not signed in" };
  if (!canAuditQuality(user)) return { ok: false, error: NOT_A_LEADER };

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That audit could not be saved" };
  const { agentId, formKey, auditDate } = parsed.data;

  if (Number.isNaN(Date.parse(`${auditDate}T00:00:00Z`)) || auditDate > new Date().toISOString().slice(0, 10)) {
    return { ok: false, error: "The audit date cannot be in the future." };
  }

  // Scope before anything is read about the agent or written: a leader
  // audits their own roster and nobody else's.
  const scope = await resolveScopedIds(user);
  if (!scope.includes(agentId)) return { ok: false, error: OUT_OF_SCOPE };

  const [formRow] = await db.select().from(qaForms).where(eq(qaForms.key, formKey)).limit(1);
  if (!formRow) return { ok: false, error: "Choose a form." };
  const form = qaFormFromRow(formRow);

  const headerValues: Record<string, string> = {};
  for (const field of form.headerFields) {
    const value = parsed.data.headerValues[field.key];
    if (!value) continue;
    if (field.kind === "select" && !(field.options ?? []).includes(value)) {
      return { ok: false, error: `${field.label}: choose one of the listed options.` };
    }
    headerValues[field.key] = value;
  }

  const allowed = markKeys(form.definition);
  const marks: QaMarks = {};
  for (const [key, mark] of Object.entries(parsed.data.marks)) if (allowed.has(key)) marks[key] = mark;
  const stepNames = new Set(stepsOf(form.definition).map((s) => s.name));
  const remarks: Record<string, string> = {};
  for (const [key, text] of Object.entries(parsed.data.remarks)) if (stepNames.has(key) && text) remarks[key] = text;

  const score = scoreAudit(form.definition, marks);
  const findings = findingRows(form.definition, marks);
  const remarksText = concatRemarks(form.definition, remarks) || null;

  const auditId = await db.transaction(async (tx) => {
    const [audit] = await tx
      .insert(qaAudits)
      .values({
        agentId,
        formKey: form.key,
        evaluatorId: user.id,
        auditDate,
        headerValues,
        remarks: remarksText,
        earnedPoints: score.earned,
        maxPoints: score.max,
        scorePct: score.scorePct.toFixed(2),
        isCritical: score.isCritical,
      })
      .returning({ id: qaAudits.id });
    await tx.insert(qaAuditResults).values(
      findings.map((f) => ({
        auditId: audit.id,
        position: f.position,
        category: f.category,
        attribute: f.attribute,
        isCompliance: f.isCompliance,
        result: f.result,
      })),
    );
    await tx.insert(auditLog).values({
      actorId: user.id,
      action: "qa.audit_filed",
      entityType: "qa_audit",
      entityId: audit.id,
      after: { agentId, formKey: form.key, auditDate, scorePct: score.scorePct, isCritical: score.isCritical },
    });
    return audit.id;
  });

  revalidatePath("/quality");
  revalidatePath("/quality/history");
  revalidatePath("/quality/analysis");
  return { ok: true, auditId };
}

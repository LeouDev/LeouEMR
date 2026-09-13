import { canAuditQuality } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { allFindingsRows, auditRawRows, csvOf, safeFilename } from "@/lib/quality/csv";
import { getQaExport } from "@/lib/queries/quality";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The raw-data CSVs: one audit (`?audit=<id>`) or every finding across every
 * audit in the caller's scope. Built on the server from the stored results,
 * so the file says what the database says, and gated exactly as the pages
 * are — an agent, or a leader asking for an audit outside their scope,
 * gets nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active" || !canAuditQuality(user)) {
    return new Response("Not allowed", { status: 403 });
  }

  const auditId = new URL(request.url).searchParams.get("audit");
  if (auditId !== null && !UUID.test(auditId)) return new Response("Bad request", { status: 400 });

  const audits = await getQaExport(user, auditId);
  if (auditId !== null && audits.length === 0) return new Response("Not found", { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  const filename =
    auditId !== null
      ? `${safeFilename("qa-audit", audits[0].agentName, audits[0].auditDate)}.csv`
      : `qa-findings-all-${today}.csv`;
  const rows = auditId !== null ? auditRawRows(audits[0]) : allFindingsRows(audits);

  return new Response(csvOf(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

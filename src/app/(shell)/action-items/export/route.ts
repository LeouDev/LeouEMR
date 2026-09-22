import { getCurrentUser } from "@/lib/auth/session";
import { CSV_BOM } from "@/lib/csv-bom";
import { csvOf } from "@/lib/csv";
import { isUuid } from "@/lib/ids";
import { ACTION_ITEMS_EXPORT_HEADER, actionItemsExportFilename, actionItemsExportRows } from "@/lib/action-items/export";
import { getActionItems } from "@/lib/queries/performance";

/**
 * The action-item list as a CSV, with the same two filters the page has
 * (`all=1` for resolved items too, `employee=<id>` for one person) and the
 * same scope: the rows come from the query the page renders, so the file
 * says what the screen says and nobody downloads an item they could not
 * open.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("Not allowed", { status: 403 });

  const params = new URL(request.url).searchParams;
  const openOnly = params.get("all") !== "1";
  const employee = params.get("employee") ?? undefined;
  const employeeId = isUuid(employee) ? employee : undefined;

  const items = await getActionItems(user, { openOnly, employeeId });
  const today = new Date().toISOString().slice(0, 10);
  const name = actionItemsExportFilename(today, openOnly);

  return new Response(CSV_BOM + csvOf([[...ACTION_ITEMS_EXPORT_HEADER], ...actionItemsExportRows(items)]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

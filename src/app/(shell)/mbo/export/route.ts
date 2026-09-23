import { getCurrentUser } from "@/lib/auth/session";
import { CSV_BOM } from "@/lib/csv-bom";
import { csvOf } from "@/lib/csv";
import { MBO_EXPORT_HEADER, mboExportFilename, mboExportRows } from "@/lib/mbo/export";
import { parseMboFilter } from "@/lib/mbo/teams";
import { getMboRoster } from "@/lib/queries/mbo";
import { parseGranularity, periodsBetween } from "@/lib/queries/period";
import { getFactDateRange } from "@/lib/queries/period-metrics";

/**
 * The MBO page as a CSV, for the same period and tab the page shows
 * (`granularity`, `period`, `status`) and the same scope: the rows come from
 * the query the page renders, grouped under the same team leaders, so the
 * file says what the screen says and nobody downloads a team they could
 * not open. An unknown period falls back to the newest one, as the page does.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active" || user.role === "agent") {
    return new Response("Not allowed", { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const granularity = parseGranularity(params.get("granularity") ?? undefined);
  const filter = parseMboFilter(params.get("status") ?? undefined);

  const range = await getFactDateRange();
  const periods = range ? periodsBetween(granularity, range.first, range.last) : [];
  const period = periods.find((p) => p.start === params.get("period")) ?? periods[0];
  if (!period) return new Response("No performance data yet", { status: 404 });

  const roster = await getMboRoster(user, period);
  const name = mboExportFilename(period.start, filter);

  return new Response(CSV_BOM + csvOf([[...MBO_EXPORT_HEADER], ...mboExportRows(roster.rows, filter)]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

import { isSupportRole } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { CSV_BOM } from "@/lib/csv-bom";
import { csvOf } from "@/lib/csv";
import { LEAVE_REGISTER_EXPORT_HEADER, leaveRegisterExportFilename, leaveRegisterExportRows, leaveRowsOf } from "@/lib/ews/export";
import { getEwsRoster, getEwsTeams } from "@/lib/queries/ews";
import { resolveTeam } from "../../access";

/** The leave and absence register as a CSV, for the same team and scope the page shows. */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active" || user.role === "agent" || isSupportRole(user)) {
    return new Response("Not allowed", { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const teams = await getEwsTeams(user);
  const team = resolveTeam(user, teams, params.get("team") ?? undefined);
  const roster = await getEwsRoster(user, team, null);
  const today = new Date().toISOString().slice(0, 10);

  const rows = leaveRowsOf(roster.rows);

  return new Response(CSV_BOM + csvOf([[...LEAVE_REGISTER_EXPORT_HEADER], ...leaveRegisterExportRows(rows, today)]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${leaveRegisterExportFilename(today)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

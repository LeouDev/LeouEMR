import { isSupportRole } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { CSV_BOM } from "@/lib/csv-bom";
import { csvOf } from "@/lib/csv";
import { ewsRosterExportFilename, ewsRosterExportHeader, ewsRosterExportRows } from "@/lib/ews/export";
import { getEwsRoster, getEwsTeams } from "@/lib/queries/ews";
import { resolveTeam } from "../access";

/**
 * The My Team roster as a CSV, for the same team the page shows and the
 * same scope: the rows come from the query the page renders, so the file
 * says what the screen says and nobody downloads a team they could not
 * open. One YES/NO column per indicator, the derived ones from the data.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active" || user.role === "agent" || isSupportRole(user)) {
    return new Response("Not allowed", { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const teams = await getEwsTeams(user);
  const team = resolveTeam(user, teams, params.get("team") ?? undefined);
  const roster = await getEwsRoster(user, team);
  const today = new Date().toISOString().slice(0, 10);
  const name = ewsRosterExportFilename(today, team);

  return new Response(
    CSV_BOM + csvOf([ewsRosterExportHeader(roster.indicators), ...ewsRosterExportRows(roster.rows, roster.indicators)]),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "Cache-Control": "no-store",
      },
    },
  );
}

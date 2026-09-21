import * as XLSX from "xlsx";
import { employeeScope, isSupportRole } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import { CSV_BOM } from "@/lib/csv-bom";
import { csvOf } from "@/lib/csv";
import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";
import { getRampProgression, loadTeamAgents } from "@/lib/queries/ramp-progression";
import { EXPORT_HEADER, exportFilename, exportRows, type ExportRow } from "@/lib/ramp/progression-export";

/**
 * The progression grid as a file — `?format=xlsx` for a workbook, anything
 * else for CSV.
 *
 * Built on the server from the same cached computation the page renders, so
 * the file says what the screen says, and scoped exactly as the page is: a
 * supervisor downloads their own team, a manager their span, an admin
 * everyone. Asking for a format is not asking for other people's teams.
 *
 * Flat rather than nested — a team's own averages and its agents' rows side
 * by side, told apart by a Level column. See progression-export.ts for why.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active" || user.role === "agent" || isSupportRole(user)) {
    return new Response("Not allowed", { status: 403 });
  }

  const scope = employeeScope(user);
  if (scope === null) return new Response("Not allowed", { status: 403 });

  const [everyTeam, mine] = await Promise.all([
    getRampProgression(),
    db
      .select({ supervisor: employees.supervisorName })
      .from(employees)
      .where(scope === "all" ? undefined : scope),
  ]);

  const visible = new Set(mine.map((r) => r.supervisor ?? "Unassigned"));
  const teams = everyTeam.filter((team) => visible.has(team.supervisor));

  // Agents are fetched per team here, unlike on the page where they wait for
  // a click: a download nobody can expand is only useful complete.
  const groups: ExportRow[] = [];
  for (const team of teams) {
    groups.push({ supervisor: team.supervisor, agentName: "", eid: "", rows: team.rows });
    for (const agent of await loadTeamAgents(team.supervisor)) {
      groups.push({
        supervisor: team.supervisor,
        agentName: agent.employeeName,
        eid: agent.eid,
        rows: agent.rows,
      });
    }
  }

  const rows = exportRows(groups);
  const today = new Date().toISOString().slice(0, 10);
  const name = exportFilename(today);
  const wantsWorkbook = new URL(request.url).searchParams.get("format") === "xlsx";

  if (!wantsWorkbook) {
    return new Response(CSV_BOM + csvOf([[...EXPORT_HEADER], ...rows]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // aoa_to_sheet keeps the numbers numbers: a spreadsheet of text that looks
  // like numbers cannot be averaged or charted, which is most of the reason
  // to want the workbook rather than the CSV.
  const sheet = XLSX.utils.aoa_to_sheet([[...EXPORT_HEADER], ...rows]);
  sheet["!freeze"] = { xSplit: "7", ySplit: "1" };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Ramp progression");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

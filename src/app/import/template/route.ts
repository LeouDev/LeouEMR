import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth/session";
import { buildTemplateWorkbook } from "@/lib/import-pipeline/template";

/** Serves the blank upload workbook. Admin-only, like the upload itself. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.status !== "active" || user.role !== "admin") {
    return new Response("Not found", { status: 404 });
  }

  const buffer = XLSX.write(buildTemplateWorkbook(), {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="optumrx-emr-upload-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

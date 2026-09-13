import { Card, CardHeader, EmptyState } from "@/components/ui";
import { HISTORY_LIMIT, getQaHistory } from "@/lib/queries/quality";
import { canFileAudit } from "@/lib/auth/scope";
import { requireQualityUser } from "../access";
import { QualityBand, QualityTabs } from "../quality-tabs";
import { HistoryTable } from "./history-table";

export default async function QualityHistoryPage() {
  const user = await requireQualityUser();
  const rows = await getQaHistory(user);

  return (
    <>
      <QualityBand />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <QualityTabs active="history" canFile={canFileAudit(user)} />
        <Card>
          <CardHeader
            title="Audit history"
            subtitle={
              rows.length >= HISTORY_LIMIT
                ? `The latest ${HISTORY_LIMIT} audits in your scope · click a row for the detail · the CSV carries every audit`
                : `${rows.length} audit${rows.length === 1 ? "" : "s"} in your scope · click a row for the detail`
            }
            action={
              rows.length > 0 ? (
                <a href="/quality/export" className="btn-secondary inline-block px-4 py-2 text-sm">
                  Download all raw data (CSV)
                </a>
              ) : undefined
            }
          />
          {rows.length === 0 ? (
            <EmptyState title="No audits yet" description="Audits filed for your roster appear here, newest first." />
          ) : (
            <HistoryTable rows={rows} />
          )}
        </Card>
      </main>
    </>
  );
}

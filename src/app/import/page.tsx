import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Card, CardHeader, EmptyState, PageBand } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { importBatches, users } from "@/lib/db/schema";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  if (user.role !== "admin") redirect("/dashboard");

  const history = await db
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      uploadedAt: importBatches.uploadedAt,
      status: importBatches.status,
      rowCounts: importBatches.rowCounts,
      uploadedByName: users.name,
    })
    .from(importBatches)
    .leftJoin(users, eq(users.id, importBatches.uploadedBy))
    .orderBy(desc(importBatches.uploadedAt))
    .limit(10);

  return (
    <div className="min-h-screen bg-cream">
      <AppHeader user={user} current="/import" />

      <PageBand
        title="Import performance data"
        subtitle="Administrators are the only role that can upload raw data"
      />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
            <div className="max-w-xl">
              <p className="text-sm font-medium text-ink">Start from the template</p>
              <p className="mt-1 text-sm text-muted">
                A blank workbook with every sheet and column the importer reads, plus one example row
                each. Uploading a week that already exists replaces that week&apos;s computed values
                and leaves earlier weeks untouched, so a corrected file can be re-imported safely.
              </p>
            </div>
            <a
              href="/import/template"
              download
              className="btn-primary shrink-0 px-5 py-3 text-sm"
            >
              Download Excel template
            </a>
          </div>
        </Card>

        <ImportWizard />

        <Card className="mt-6">
          <CardHeader title="Recent imports" />
          {history.length === 0 ? (
            <EmptyState title="No imports yet" description="Uploaded workbooks will be listed here." />
          ) : (
            <ul className="divide-y divide-line">
              {history.map((batch) => {
                const counts = batch.rowCounts as { metrics?: number; weeks?: string[] } | null;
                return (
                  <li key={batch.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                    <div>
                      <p className="text-sm font-medium text-ink">{batch.fileName}</p>
                      <p className="text-xs text-muted">
                        {batch.uploadedAt.toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {batch.uploadedByName && ` · ${batch.uploadedByName}`}
                        {counts?.metrics !== undefined && ` · ${counts.metrics} metrics`}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold ${batch.status === "committed"
                          ? "bg-pass-bg text-pass"
                          : batch.status === "failed"
                            ? "bg-fail-bg text-fail"
                            : "bg-line text-muted"
                      }`}
                    >
                      {batch.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}

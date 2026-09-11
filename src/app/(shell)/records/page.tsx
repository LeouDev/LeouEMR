import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, EmptyState, PageBand, StatusBadge, formatWeek } from "@/components/ui";
import { canViewRecords } from "@/lib/auth/scope";
import { getCurrentUser } from "@/lib/auth/session";
import {
  RECORD_STATUSES,
  getCoachingRecords,
  isRecordStatus,
  type CoachingRecordRow,
} from "@/lib/queries/performance";
import { Chip, includesOf } from "./includes";
import { RecordsFilters } from "./records-filters";
import { RecordRow } from "./record-row";

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  // The archive is a leader's view; an agent's own items are on Action Items.
  if (!canViewRecords(user)) redirect("/dashboard");

  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const status = isRecordStatus(params.status) ? params.status : undefined;
  const sort = params.sort === "oldest" ? "oldest" : "newest";

  const records = await getCoachingRecords(user, { search, status, sort });
  const filtered = search !== "" || status !== undefined;

  return (
    <>
      <PageBand title="Records" subtitle="Historical coaching logs and performance records" />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <RecordsFilters statuses={RECORD_STATUSES} initial={{ q: search, status: status ?? "", sort }} />

        <Card className="mt-6">
          <CardHeader
            title="Coaching records"
            subtitle={`${records.length} record${records.length === 1 ? "" : "s"} · one per action item with something written against it. The coaching workflow itself is unchanged; this is the archive of what has been saved.`}
          />

          {records.length === 0 ? (
            <EmptyState
              title={filtered ? "No records match these filters" : "No records yet"}
              description={
                filtered
                  ? "Try clearing the search or choosing another status."
                  : "A record appears here once an RCA, action plan, time-and-motion study or acknowledgement has been saved on an action item."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink bg-cream">
                    <th className="px-6 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Employee</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Coaching date</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Includes</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Status</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold tracking-[0.08em] text-ink uppercase">Filed by</th>
                    <th className="px-6 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {records.map((record: CoachingRecordRow) => {
                    const href = `/records/${record.actionItemId}`;
                    return (
                      <RecordRow key={record.actionItemId} href={href}>
                        <td className="px-6 py-2.5">
                          <Link
                            href={href}
                            prefetch={false}
                            className="font-semibold text-ink underline-offset-4 hover:text-orange-brand hover:underline"
                          >
                            {record.employeeName}
                          </Link>
                          <p className="font-mono text-xs text-muted">
                            {record.actionItemCode} · {record.kpiName}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-ink">{formatWeek(record.latestWeek)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {includesOf(record).map((chip) => (
                              <Chip key={chip}>{chip}</Chip>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={record.status} />
                        </td>
                        <td className="px-3 py-2.5 text-muted">{record.filedBy ?? "—"}</td>
                        <td className="px-6 py-2.5 text-right text-orange-brand" aria-hidden="true">
                          →
                        </td>
                      </RecordRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}

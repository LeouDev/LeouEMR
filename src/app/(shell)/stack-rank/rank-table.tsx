import Link from "next/link";
import { EmptyState } from "@/components/ui";
import type { RankRow, SupervisorRankRow } from "@/lib/queries/stack-rank";

const HEAD = "px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase";

/** How many rows either side of the viewer's own to keep when abridging. */
const NEIGHBOURS = 3;

/**
 * The rows worth rendering of a long ranking: the top `top`, plus a window
 * around the viewer's own rank when it falls below that. Ranks are kept as
 * computed, so the gap between the two blocks is visible as a jump in the
 * rank column rather than hidden. Pure, so the exact cut can be tested.
 */
export function abridge<T extends { rank: number }>(rows: T[], top: number, selfRank?: number): T[] {
  if (rows.length <= top) return rows;
  const keep = new Set<number>();
  for (let rank = 1; rank <= top; rank++) keep.add(rank);
  if (selfRank !== undefined) {
    for (let rank = selfRank - NEIGHBOURS; rank <= selfRank + NEIGHBOURS; rank++) keep.add(rank);
  }
  return rows.filter((row) => keep.has(row.rank));
}
const NUM = "px-3 py-2.5 font-mono tabular-nums";

function rate(value: number | null, digits = 3) {
  return value === null ? "—" : value.toFixed(digits);
}

/** A medal-free rank badge; the top three simply read darker. */
function Rank({ rank, highlight }: { rank: number; highlight: boolean }) {
  return (
    <span
      className={`inline-flex h-7 min-w-7 items-center justify-center px-1.5 font-mono text-sm font-bold tabular-nums ${
        highlight
          ? "bg-orange-brand text-white"
          : rank <= 3
            ? "bg-ink text-white"
            : "bg-line text-ink"
      }`}
    >
      {rank}
    </span>
  );
}

/**
 * A stack rank of people.
 *
 * `selfId` marks the viewer's own row so they can find themselves without
 * reading every line — the whole point of a stack rank for an agent.
 */
export function RankTable({
  rows,
  selfId,
  emptyTitle,
  emptyDescription,
  showSupervisor = false,
  visibleRows,
}: {
  rows: RankRow[];
  selfId: string | null;
  emptyTitle: string;
  emptyDescription: string;
  showSupervisor?: boolean;
  /**
   * Cap the table's height at roughly this many rows and scroll the rest
   * inside it. A 452-row ranking otherwise runs the page to several screens
   * and buries everything below it.
   */
  visibleRows?: number;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  // Roughly a row's height; only used to bound the scroll area.
  const scrolls = visibleRows !== undefined && rows.length > visibleRows;

  return (
    <div
      className="overflow-x-auto"
      style={scrolls ? { maxHeight: `${visibleRows! * 41 + 42}px`, overflowY: "auto" } : undefined}
    >
      <table className="w-full min-w-[720px] border-collapse text-sm">
        {/* Sticky within the scroll container, so the columns stay readable
            while scrolling down a long ranking. */}
        <thead className={scrolls ? "sticky top-0 z-20" : undefined}>
          <tr className="border-b-2 border-ink bg-cream">
            <th className="bg-cream px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Rank
            </th>
            <th className="bg-cream px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Employee
            </th>
            {showSupervisor && (
              <th className="bg-cream px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
                Supervisor
              </th>
            )}
            <th className={`${HEAD} bg-cream`}>Rating</th>
            <th className={`${HEAD} bg-cream`}>MBO</th>
            <th className={`${HEAD} bg-cream`}>Quality</th>
            <th className={`${HEAD} bg-cream pr-6`}>Attendance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelf = row.employeeId === selfId;
            return (
              <tr
                key={row.employeeId}
                className={`border-b-2 border-line last:border-0 ${
                  isSelf ? "bg-orange-brand-100" : "hover:bg-cream"
                }`}
              >
                <td className="px-6 py-2.5">
                  <Rank rank={row.rank} highlight={isSelf} />
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    href={`/employees/${row.employeeId}`}
                    prefetch={false}
                    className={`underline-offset-4 hover:text-orange-brand hover:underline ${
                      isSelf ? "font-bold text-ink" : "font-medium text-ink"
                    }`}
                  >
                    {row.name}
                  </Link>
                  {isSelf && (
                    <span className="ml-2 bg-ink px-1.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white uppercase">
                      You
                    </span>
                  )}
                </td>
                {showSupervisor && (
                  <td className="px-3 py-2.5 text-muted">{row.supervisorName ?? "—"}</td>
                )}
                <td className={`${NUM} font-semibold text-ink`}>{rate(row.productionRate)}</td>
                <td className={`${NUM} text-muted`}>
                  {row.mbo === null ? "—" : `${row.mbo.toFixed(0)}%`}
                </td>
                <td className={`${NUM} text-muted`}>
                  {row.quality === null ? "—" : `${row.quality.toFixed(1)}%`}
                </td>
                <td className={`${NUM} pr-6 text-muted`}>
                  {row.attendance === null ? "—" : `${row.attendance.toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Supervisors ranked by their team's mean rating. */
export function SupervisorRankTable({
  rows,
  selfSupervisor,
}: {
  rows: SupervisorRankRow[];
  selfSupervisor: string | null;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No supervisors to rank"
        description="Supervisors appear here once their teams have scored performance data."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-ink bg-cream">
            <th className="px-6 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Rank
            </th>
            <th className="px-3 py-2.5 text-xs font-semibold tracking-[0.08em] text-ink uppercase">
              Supervisor
            </th>
            <th className={HEAD}>Team</th>
            <th className={HEAD}>Scored</th>
            <th className={HEAD}>Avg rating</th>
            <th className={`${HEAD} pr-6`}>Avg MBO</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelf = row.supervisorName === selfSupervisor;
            return (
              <tr
                key={row.supervisorName}
                className={`border-b-2 border-line last:border-0 ${
                  isSelf ? "bg-orange-brand-100" : "hover:bg-cream"
                }`}
              >
                <td className="px-6 py-2.5">
                  <Rank rank={row.rank} highlight={isSelf} />
                </td>
                <td className="px-3 py-2.5 font-medium text-ink">
                  {row.supervisorName}
                  {isSelf && (
                    <span className="ml-2 bg-ink px-1.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white uppercase">
                      Your team
                    </span>
                  )}
                </td>
                <td className={`${NUM} text-muted`}>{row.teamSize}</td>
                <td className={`${NUM} text-muted`}>{row.scored}</td>
                <td className={`${NUM} font-semibold text-ink`}>{rate(row.productionRate)}</td>
                <td className={`${NUM} pr-6 text-muted`}>
                  {row.mbo === null ? "—" : `${row.mbo.toFixed(0)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

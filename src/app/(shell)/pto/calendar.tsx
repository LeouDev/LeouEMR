import Link from "next/link";

interface DayEntry {
  name: string;
  status: string;
  /** Null when the viewer may not see why someone is away. */
  type: string | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A month grid of who is away.
 *
 * Rendered on the server with no client state: the month is a URL parameter,
 * so a particular month is a link someone can share rather than a state that
 * only exists in one browser tab.
 */
export function PtoCalendar({
  month,
  byDay,
}: {
  month: string;
  byDay: Map<string, DayEntry[]>;
}) {
  const [year, monthNum] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNum - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();

  const leading = first.getUTCDay();

  const cells: Array<string | null> = [
    ...Array<null>(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      `${month}-${String(i + 1).padStart(2, "0")}`,
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b-2 border-line px-6 py-3">
        <Link
          href={`/pto?month=${shiftMonth(month, -1)}`}
          className="border-2 border-ink px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-ink uppercase transition hover:bg-orange-brand-100"
        >
          ← Previous
        </Link>
        <span className="text-sm font-bold text-ink">{monthLabel(month)}</span>
        <Link
          href={`/pto?month=${shiftMonth(month, 1)}`}
          className="border-2 border-ink px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-ink uppercase transition hover:bg-orange-brand-100"
        >
          Next →
        </Link>
      </div>

      <div className="grid grid-cols-7 border-b-2 border-line">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-[11px] font-bold tracking-[0.08em] text-muted uppercase"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const entries = day ? (byDay.get(day) ?? []) : [];
          return (
            <div
              key={day ?? `blank-${i}`}
              className={`min-h-24 border-r-2 border-b-2 border-line p-1.5 last:border-r-0 ${
                !day ? "bg-cream/50" : day === today ? "bg-orange-brand-100" : ""
              }`}
            >
              {day && (
                <>
                  <div className="mb-1 text-right font-mono text-[11px] text-muted tabular-nums">
                    {Number(day.slice(8))}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {entries.slice(0, 3).map((e, n) => (
                      <span
                        key={`${e.name}-${n}`}
                        title={e.type ? `${e.name} — ${e.type} (${e.status})` : `${e.name} — ${e.status}`}
                        className={`truncate px-1 py-0.5 text-[10px] font-semibold ${
                          e.status === "approved"
                            ? "bg-pass-bg text-pass"
                            : "border border-warn bg-warn-bg text-warn"
                        }`}
                      >
                        {e.name.split(",")[0]}
                      </span>
                    ))}
                    {entries.length > 3 && (
                      <span className="px-1 text-[10px] font-semibold text-muted">
                        +{entries.length - 3} more
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 px-6 py-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 bg-pass-bg" /> Approved
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 border border-warn bg-warn-bg" /> Pending
        </span>
      </div>
    </div>
  );
}

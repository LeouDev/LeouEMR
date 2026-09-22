import type { CategoryDrill } from "@/lib/quality/analysis";

/**
 * The charts the shared chart set does not have: a count bar list (a
 * failure count is not a rate, so BarList's percent axis does not fit),
 * the category drill-down and the outcome donut. Server-rendered SVG and
 * divs, like the rest.
 */

export function CountBars({
  rows,
  tone,
  emptyMessage = "Nothing to show in this range.",
}: {
  rows: Array<{ label: string; count: number }>;
  tone: "fail" | "ink";
  emptyMessage?: string;
}) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-sm text-ink" title={row.label}>
            {row.label}
          </span>
          <span className="font-mono text-sm font-semibold text-ink tabular-nums">{row.count}</span>
          <div className="col-span-2 h-1.5 overflow-hidden bg-line">
            <div className={`h-full ${tone === "fail" ? "bg-fail" : "bg-ink"}`} style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Passed, failed and critical audits as one ring, with the counts beside it. */
export function OutcomeDonut({ passed, failed, critical }: { passed: number; failed: number; critical: number }) {
  const total = passed + failed + critical;
  if (total === 0) return <p className="py-8 text-center text-sm text-muted">No audits in this range.</p>;

  const R = 40;
  const C = 2 * Math.PI * R;
  const segments = [
    { label: "Passed", count: passed, color: "var(--color-pass)" },
    { label: "Failed", count: failed, color: "var(--color-orange-brand)" },
    { label: "Critical", count: critical, color: "var(--color-fail)" },
  ];
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" width={104} height={104} role="img" aria-label={`${passed} passed, ${failed} failed, ${critical} critical`}>
        <circle cx={50} cy={50} r={R} fill="none" stroke="var(--color-line)" strokeWidth={14} />
        {segments.map((seg) => {
          const length = (seg.count / total) * C;
          const el = (
            <circle
              key={seg.label}
              cx={50}
              cy={50}
              r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth={14}
              strokeDasharray={`${length} ${C - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          );
          offset += length;
          return el;
        })}
        <text x={50} y={54} textAnchor="middle" className="fill-ink text-[16px] font-extrabold">
          {total}
        </text>
      </svg>
      <ul className="flex flex-1 flex-col gap-1.5 text-sm">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-ink">
              <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ backgroundColor: seg.color }} />
              {seg.label}
            </span>
            <span className="font-mono font-bold text-ink tabular-nums">
              {seg.count}
              <span className="ml-1 font-normal text-muted">({Math.round((seg.count / total) * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Failed categories, each a disclosure that opens onto the attributes
 * failed under it — the "why" behind a category's count without leaving
 * the page. Plain <details>, so it prints closed and works without
 * JavaScript; the top category opens by default because it is the one
 * the reader came for.
 */
export function CategoryDrilldown({
  rows,
  emptyMessage = "Nothing to show in this range.",
}: {
  rows: CategoryDrill[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-1.5">
      {rows.map((row, i) => (
        <li key={row.label}>
          <details open={i === 0} className="group">
            <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-1 py-1 [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="inline-block w-[9px] text-xs text-muted transition-transform duration-[120ms] group-open:rotate-90">
                ▸
              </span>
              <span className="truncate text-sm text-ink" title={row.label}>
                {row.label}
              </span>
              <span className="text-xs text-muted tabular-nums">{row.share}%</span>
              <span className="font-mono text-sm font-semibold text-ink tabular-nums">{row.count}</span>
              <div className="col-span-3 col-start-2 h-1.5 overflow-hidden bg-line">
                <div className="h-full bg-fail" style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
            </summary>
            <ol className="mt-1.5 mb-2 ml-5 space-y-1 border-l-2 border-line pl-3">
              {row.attributes.map((attribute) => (
                <li key={attribute.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-xs">
                  <span className="truncate text-ink" title={attribute.label}>
                    {attribute.label}
                  </span>
                  <span className="font-mono font-semibold text-ink tabular-nums">{attribute.count}</span>
                </li>
              ))}
            </ol>
          </details>
        </li>
      ))}
    </ul>
  );
}

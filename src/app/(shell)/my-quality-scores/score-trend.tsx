import { PASS_THRESHOLD } from "@/lib/quality/scoring";
import type { TrendPoint } from "@/lib/quality/my-scores";

/**
 * An agent's audits in order, one point each, against the pass line. A
 * point is green when nothing was failed on that audit and red when
 * something was — the same signal as the drawer's findings list.
 */
export function ScoreTrend({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return <p className="py-8 text-center text-sm text-muted">Your trend appears once you have two audits.</p>;
  }

  const W = 600;
  const H = 220;
  const baseline = 190;
  const top = 30;
  const x0 = 22;
  const step = (W - x0 * 2) / (points.length - 1);
  const x = (i: number) => x0 + i * step;
  const y = (v: number) => baseline - (Math.max(0, Math.min(100, v)) / 100) * (baseline - top);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.scorePct).toFixed(1)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} role="img" aria-label="Score trend">
      {[0, 50, 100].map((v) => (
        <line key={v} x1={0} y1={y(v)} x2={W} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
      ))}
      <line x1={0} y1={baseline} x2={W} y2={baseline} stroke="var(--color-ink)" strokeWidth={2} />
      <line x1={0} y1={y(PASS_THRESHOLD)} x2={W} y2={y(PASS_THRESHOLD)} stroke="var(--color-orange-brand)" strokeWidth={2} strokeDasharray="6 5" />
      <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth={2.5} strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={p.id}>
          <rect x={x(i) - 4.5} y={y(p.scorePct) - 4.5} width={9} height={9} fill={p.hadFail ? "var(--color-fail)" : "var(--color-pass)"}>
            <title>{`${p.label}: ${Math.round(p.scorePct)}%${p.hadFail ? " · with findings" : " · clean"}`}</title>
          </rect>
          {(i === points.length - 1 || i % labelEvery === 0) && (
            <text x={x(i)} y={y(p.scorePct) - 10} textAnchor="middle" className="fill-ink text-[11px] font-bold">
              {Math.round(p.scorePct)}
            </text>
          )}
          {(i % labelEvery === 0 || i === points.length - 1) && (
            <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted text-[10px] font-semibold">
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

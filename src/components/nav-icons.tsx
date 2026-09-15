import type { ReactNode } from "react";

/**
 * One line icon per destination, in the app's stroke style (1.8, square
 * corners, the current text colour), so the folded rail can show a glyph
 * where the label no longer fits. Keyed by href: the label varies by role
 * ("Skills" is "My Tools" for a team leader) but the destination does not.
 */
const GLYPHS: Record<string, ReactNode> = {
  "/dashboard": (
    <>
      <rect x={3} y={3} width={8} height={8} />
      <rect x={13} y={3} width={8} height={8} />
      <rect x={3} y={13} width={8} height={8} />
      <rect x={13} y={13} width={8} height={8} />
    </>
  ),
  "/analytics": <path d="M5 20v-8M11 20V5M17 20v-11M3 20h18" />,
  "/employees": (
    <>
      <circle cx={9} cy={8} r={3.2} />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx={17} cy={9} r={2.5} />
      <path d="M21 19c0-2.5-1.7-4.5-4-4.8" />
    </>
  ),
  "/action-items": (
    <>
      <rect x={5} y={4} width={14} height={17} />
      <path d="M9 4V2h6v2" />
      <path d="M8.5 13l2.5 2.5 4.5-5" />
    </>
  ),
  "/records": (
    <>
      <rect x={3} y={4} width={18} height={5} />
      <path d="M5 9v11h14V9M10 13h4" />
    </>
  ),
  "/my-space": (
    <>
      <rect x={4} y={4} width={16} height={16} />
      <path d="M4 12h16M12 4v16" />
      <path d="M6.5 8.5l1.3 1.3L10 7.3" />
    </>
  ),
  "/development": <path d="M3 17l5-5 4 4 8-8M15 8h5v5" />,
  "/pto": (
    <>
      <rect x={3} y={5} width={18} height={16} />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  "/stack-rank": <path d="M3 21v-9h6v9M9 21V7h6v14M15 21v-5h6v5M2 21h20" />,
  "/my-stats": (
    <>
      <rect x={5} y={3} width={14} height={18} />
      <path d="M8 7h8" />
      <circle cx={8.5} cy={11.5} r={0.9} fill="currentColor" stroke="none" />
      <circle cx={12} cy={11.5} r={0.9} fill="currentColor" stroke="none" />
      <circle cx={15.5} cy={11.5} r={0.9} fill="currentColor" stroke="none" />
      <circle cx={8.5} cy={15.5} r={0.9} fill="currentColor" stroke="none" />
      <circle cx={12} cy={15.5} r={0.9} fill="currentColor" stroke="none" />
      <circle cx={15.5} cy={15.5} r={0.9} fill="currentColor" stroke="none" />
    </>
  ),
  "/my-quality-scores": <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />,
  "/scorecard": (
    <>
      <rect x={5} y={3} width={14} height={18} />
      <circle cx={12} cy={10} r={3} />
      <path d="M8 17h8" />
    </>
  ),
  "/mbo": (
    <>
      <circle cx={12} cy={12} r={8} />
      <circle cx={12} cy={12} r={4.5} />
      <circle cx={12} cy={12} r={1.2} fill="currentColor" stroke="none" />
    </>
  ),
  "/skills": (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx={9} cy={7} r={2.2} />
      <circle cx={15} cy={17} r={2.2} />
    </>
  ),
  "/ews": (
    <>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.2h.01" />
    </>
  ),
  "/ramp": <path d="M3 20h5v-5h5v-5h5V5h3" />,
  "/adherence": (
    <>
      <circle cx={12} cy={12} r={8.5} />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  "/quality": (
    <>
      <circle cx={10.5} cy={10.5} r={6} />
      <path d="M15 15l5.5 5.5M8 10.5l1.8 1.8 3.2-3.5" />
    </>
  ),
  "/201-file": <path d="M3 6h6l2 2h10v12H3z" />,
  "/import": <path d="M12 3v11M8 10l4 4 4-4M4 16v4h16v-4" />,
  "/users": (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" />
      <circle cx={12} cy={10.5} r={2.3} />
      <path d="M8.5 17c.6-2 1.9-3 3.5-3s2.9 1 3.5 3" />
    </>
  ),
};

/** A destination with no glyph yet still gets a mark, so the folded rail never shows a blank slot. */
const FALLBACK = <circle cx={12} cy={12} r={3} />;

export function NavIcon({ href, className = "h-4 w-4" }: { href: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {GLYPHS[href] ?? FALLBACK}
    </svg>
  );
}

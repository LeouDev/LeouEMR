/**
 * EMR — Performance Command Center brand marks.
 *
 * Ported from the supplied logo sheet: a navy globe with an orange horizon,
 * a syringe rising from it, and two stars. Flat fills only, 2px–4px strokes,
 * no radius — the marks obey the same Modernist Navy rules as the interface.
 *
 * Every id here is suffixed per instance: several marks can appear on one
 * page (header, lockup, favicon) and duplicate clipPath ids would make one
 * silently clip another.
 */

/** The globe-and-syringe mark, on its own navy ground. */
export function BrandMark({
  className = "h-9 w-9",
  id = "mark",
}: {
  className?: string;
  id?: string;
}) {
  const clip = `brand-clip-${id}`;

  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      role="img"
      aria-label="EMR Performance Command Center"
    >
      <circle cx={60} cy={60} r={56} fill="var(--navy-600)" stroke="var(--bg)" strokeWidth={4} />
      <clipPath id={clip}>
        <circle cx={60} cy={60} r={54} />
      </clipPath>
      {/* Orange horizon: the same "filling the globe" idea as the loading scene. */}
      <rect x={0} y={66} width={120} height={60} fill="var(--orange-500)" clipPath={`url(#${clip})`} />
      <g transform="translate(60,52) rotate(-38)">
        <rect x={-7} y={-46} width={14} height={44} fill="var(--bg)" />
        <rect x={-5} y={-30} width={10} height={26} fill="var(--orange-500)" />
        <rect x={-11} y={-52} width={22} height={6} fill="var(--bg)" />
        <rect x={-2} y={-64} width={4} height={12} fill="var(--bg)" />
        <rect x={-8} y={-68} width={16} height={4} fill="var(--bg)" />
        <rect x={-1.5} y={-2} width={3} height={18} fill="var(--bg)" />
      </g>
      <circle cx={34} cy={26} r={1.8} fill="var(--bg)" />
      <circle cx={92} cy={40} r={1.4} fill="var(--bg)" />
    </svg>
  );
}

/**
 * "EMR" over an orange rule over the descriptor.
 *
 * `tone` picks the text colour for the ground it sits on; the rule stays
 * orange either way, since the accent reads on both.
 */
export function BrandWordmark({
  className = "",
  tone = "dark",
  size = "sm",
}: {
  className?: string;
  tone?: "dark" | "light";
  size?: "sm" | "lg";
}) {
  // Below `sm` the header has no room for the descriptor; hiding it beats
  // letting it wrap under the "EMR" and push the nav down.
  const descriptor = size === "lg" ? "block" : "hidden sm:block";
  const text = tone === "light" ? "text-cream" : "text-ink";

  return (
    <div className={`flex flex-col gap-1.5 ${text} ${className}`}>
      <div
        className={`leading-none font-extrabold tracking-[-0.02em] ${size === "lg" ? "text-[40px]" : "text-xl"
        }`}
      >
        EMR
      </div>
      <div className="h-0.5 w-full bg-orange-brand" />
      <div
        className={`${descriptor} font-bold tracking-[0.16em] whitespace-nowrap uppercase ${
          size === "lg" ? "text-xs" : "text-[9px]"
        }`}
      >
        Performance Command Center
      </div>
    </div>
  );
}

/** Mark plus wordmark, on the navy ground — the sign-in and header lockup. */
export function BrandLockup({
  tone = "dark",
  className = "",
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-7 ${className}`}>
      <BrandMark className="h-28 w-28" id="lockup" />
      <BrandWordmark tone={tone} size="lg" />
    </div>
  );
}

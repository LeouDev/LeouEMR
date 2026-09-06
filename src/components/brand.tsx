/**
 * Brand lockup for OptumRX EMR.
 *
 * This is a CSS/SVG rendition of the logo so the app is correctly branded
 * without a binary asset. To use the real artwork instead, drop it at
 * public/logo.png and swap <BrandMark /> for an <Image src="/logo.png" />.
 */

export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="OptumRX EMR">
      <circle cx="24" cy="24" r="21.5" fill="var(--brand-cream)" />
      {/* Two-tone ring: navy sweeping into orange, as in the logo. */}
      <path
        d="M24 2.5a21.5 21.5 0 0 1 0 43"
        fill="none"
        stroke="var(--brand-orange)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M24 45.5a21.5 21.5 0 0 1 0-43"
        fill="none"
        stroke="var(--brand-navy-800)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* Record card with patient glyph and detail lines. */}
      <rect
        x="14"
        y="15"
        width="21"
        height="15"
        rx="3"
        fill="none"
        stroke="var(--brand-navy-800)"
        strokeWidth="2.4"
      />
      <circle cx="20.5" cy="20.5" r="2.1" fill="var(--brand-navy-800)" />
      <path
        d="M17.6 26q2.9-3.2 5.8 0"
        fill="none"
        stroke="var(--brand-navy-800)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M27.5 19.5h4.5M27.5 23.5h4.5"
        stroke="var(--brand-navy-500)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Motion lines in orange. */}
      <path
        d="M7.5 33.5h8M11 38h7"
        stroke="var(--brand-orange)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-tight text-navy-800 ${className}`}>
      Optum<span className="text-orange-brand">RX</span>
      <span className="ml-1.5 font-medium text-navy-500">EMR</span>
    </span>
  );
}

/** Full stacked lockup with tagline — for the sign-in screen. */
export function BrandLockup() {
  return (
    <div className="flex flex-col items-center text-center">
      <BrandMark className="h-16 w-16" />
      <div className="mt-3 text-2xl font-bold tracking-tight text-navy-800">
        Optum<span className="text-orange-brand">RX</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="h-px w-6 bg-navy-100" />
        <span className="text-sm font-semibold tracking-[0.25em] text-navy">EMR</span>
        <span className="h-px w-6 bg-navy-100" />
      </div>
      <p className="mt-2 text-[11px] font-medium tracking-[0.18em] text-navy-500 uppercase">
        People <span className="text-orange-brand">|</span> Process{" "}
        <span className="text-orange-brand">|</span> Progress
      </p>
    </div>
  );
}

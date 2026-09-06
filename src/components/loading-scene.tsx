import type { CSSProperties, ReactNode } from "react";

/**
 * The auth scene — an astronaut injecting the earth, orange filling the navy
 * globe as work completes.
 *
 * Ported from the Modernist Navy reference. The whole timeline is driven by
 * one duration so the scene, the progress bar and the step list stay in step
 * with each other; `running` false parks every element at its start pose so
 * the same markup serves as the still backdrop behind a form.
 */

const DEFAULT_SECONDS = 6;

/** Stars, hand-placed so they read as a composition rather than noise. */
const STARS: Array<[cx: number, cy: number, r: number, dur: number, delay: number]> = [
  [60, 140, 1.6, 2.6, 0],
  [180, 90, 1.2, 3.1, 0.4],
  [520, 120, 1.8, 2.2, 0.9],
  [430, 240, 1.2, 2.9, 0.2],
  [90, 360, 1.4, 3.4, 1.2],
  [560, 420, 1.3, 2.4, 0.6],
  [300, 170, 1, 2.8, 1.5],
  [140, 520, 1.6, 3, 0.8],
];

/** Continents, as flat shapes with no gradient — the theme forbids tints. */
const CONTINENTS = [
  "M-110,-60 c20,-30 60,-40 80,-20 c15,15 -5,40 -30,45 c-25,5 -50,10 -60,-5 c-6,-8 0,-15 10,-20z",
  "M-20,-30 c30,-10 70,0 90,25 c15,20 5,50 -25,55 c-30,5 -60,-10 -70,-35 c-6,-15 -10,-38 5,-45z",
  "M-90,30 c15,-5 40,5 45,30 c5,25 -15,45 -35,40 c-20,-5 -30,-25 -25,-45 c2,-12 8,-22 15,-25z",
  "M60,60 c20,-15 50,-5 55,20 c4,20 -15,35 -35,30 c-20,-5 -35,-25 -20,-50z",
  "M-150,-120 c20,-5 40,0 45,15 c5,15 -15,25 -35,20 c-15,-4 -20,-20 -10,-35z",
];

export function SpaceScene({
  running = false,
  seconds = DEFAULT_SECONDS,
  kicker = "Weekly performance management",
  headline = "One signal for supervisors, managers and agents.",
}: {
  running?: boolean;
  seconds?: number;
  kicker?: string;
  headline?: string;
}) {
  const d = `${seconds}s`;
  const anim = (name: string, easing = "cubic-bezier(.45,0,.2,1)"): CSSProperties =>
    running ? { animation: `${name} ${d} ${easing} forwards` } : {};

  return (
    <div className="relative flex min-h-[480px] flex-col overflow-hidden bg-navy-800">
      <div className="relative z-2 flex items-center gap-3 border-b-2 border-orange-brand px-8 py-7">
        <div className="h-3.5 w-3.5 bg-orange-brand" />
        <div className="text-sm font-bold tracking-[0.14em] text-cream uppercase">
          EMR · Performance Command Center
        </div>
      </div>

      <svg
        viewBox="0 0 600 640"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
        className="absolute inset-0 block h-full w-full"
      >
        <g fill="var(--bg)">
          {STARS.map(([cx, cy, r, dur, delay]) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r={r}
              style={{ animation: `twinkle ${dur}s ease-in-out ${delay}s infinite` }}
            />
          ))}
        </g>
        <line x1="0" y1="600" x2="600" y2="600" stroke="var(--navy-500)" strokeWidth={2} />
        <line x1="0" y1="200" x2="600" y2="200" stroke="var(--navy-700)" strokeWidth={1} />

        {/* Earth */}
        <g transform="translate(380,470)">
          <circle
            r={150}
            fill="none"
            stroke="var(--orange-500)"
            strokeWidth={2}
            style={
              running
                ? { animation: `ring ${d} ease-out forwards`, transformOrigin: "0 0" }
                : { opacity: 0 }
            }
          />
          <circle
            r={150}
            fill="none"
            stroke="var(--orange-500)"
            strokeWidth={1}
            style={
              running
                ? { animation: `ring2 ${d} ease-out forwards`, transformOrigin: "0 0" }
                : { opacity: 0 }
            }
          />
          <circle r={168} fill="var(--orange-500)" opacity={0} style={{ ...anim("glow"), filter: "blur(18px)" }} />
          <circle r={150} fill="var(--navy-600)" />
          <clipPath id="earthClip">
            <circle r={150} />
          </clipPath>
          <g clipPath="url(#earthClip)">
            <rect
              x={-160}
              y={-160}
              width={320}
              height={320}
              fill="var(--orange-500)"
              style={running ? anim("fillUp") : { transform: "translateY(300px)" }}
            />
          </g>
          <g fill="var(--navy-400)" opacity={0.9}>
            {CONTINENTS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <circle r={150} fill="none" stroke="var(--bg)" strokeWidth={2} />
        </g>

        {/* Astronaut */}
        <g transform="translate(470,150)">
          <g style={{ ...anim("descend"), transformOrigin: "0 0" }}>
            <g style={{ animation: "drift 4s ease-in-out infinite" }}>
              <rect x={-52} y={-6} width={104} height={92} fill="#c9ced6" />
              <rect x={-30} y={34} width={22} height={44} fill="#eef0f3" />
              <rect x={8} y={34} width={22} height={44} fill="#eef0f3" />
              <rect x={-30} y={74} width={22} height={12} fill="var(--orange-500)" />
              <rect x={8} y={74} width={22} height={12} fill="var(--orange-500)" />
              <rect x={-38} y={-10} width={76} height={70} fill="#eef0f3" />
              <rect x={-38} y={16} width={76} height={4} fill="var(--orange-500)" />
              <rect x={-18} y={26} width={36} height={22} fill="#c9ced6" />
              <rect x={-14} y={30} width={10} height={4} fill="var(--orange-500)" />
              <rect x={2} y={30} width={10} height={4} fill="var(--navy-800)" />
              <rect x={-60} y={-4} width={22} height={50} fill="#eef0f3" />
              <rect x={-62} y={44} width={26} height={14} fill="#c9ced6" />
              <circle cx={0} cy={-42} r={38} fill="#eef0f3" />
              <circle cx={0} cy={-40} r={27} fill="#1a3c6b" />
              <path
                d="M-16,-56 q8,-10 22,-6"
                stroke="var(--bg)"
                strokeWidth={4}
                fill="none"
                strokeLinecap="round"
              />
              <rect x={-40} y={-14} width={80} height={6} fill="var(--orange-500)" />

              {/* Arm holding the syringe */}
              <g transform="translate(38,4) rotate(70)">
                <rect x={-11} y={0} width={22} height={52} fill="#eef0f3" />
                <rect x={-13} y={48} width={26} height={14} fill="#c9ced6" />
                <g transform="translate(0,62)">
                  <rect
                    x={-9}
                    y={0}
                    width={18}
                    height={60}
                    fill="var(--bg)"
                    stroke="var(--navy-800)"
                    strokeWidth={2}
                  />
                  <rect
                    x={-7}
                    y={2}
                    width={14}
                    height={56}
                    fill="var(--orange-500)"
                    style={{ ...anim("drain"), transformOrigin: "0 58px" }}
                  />
                  <line x1={-9} y1={20} x2={9} y2={20} stroke="var(--navy-800)" strokeWidth={1} />
                  <line x1={-9} y1={40} x2={9} y2={40} stroke="var(--navy-800)" strokeWidth={1} />
                  <rect x={-6} y={60} width={12} height={6} fill="#c9ced6" />
                  <line x1={0} y1={66} x2={0} y2={92} stroke="var(--bg)" strokeWidth={2} />
                  <g style={anim("plunge")}>
                    <rect x={-16} y={-8} width={32} height={6} fill="#c9ced6" />
                    <rect x={-3} y={-32} width={6} height={26} fill="#c9ced6" />
                    <rect x={-14} y={-38} width={28} height={7} fill="var(--orange-500)" />
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>

      <div className="relative z-2 mt-auto max-w-[520px] px-8 py-7 text-cream">
        <div className="mb-2.5 text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
          {kicker}
        </div>
        <div className="text-[clamp(22px,2.4vw,32px)] leading-[1.15] font-bold text-pretty">
          {headline}
        </div>
      </div>
    </div>
  );
}

/** Kicker + 34px title, the heading block every auth panel opens with. */
export function PanelHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="border-b-2 border-ink pb-[18px]">
      <div className="mb-2.5 text-[11px] font-bold tracking-[0.16em] text-orange-brand uppercase">
        {kicker}
      </div>
      <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.01em] text-ink">
        {title}
      </h1>
    </div>
  );
}

/** The two-panel auth shell: scene on the left, content on the right. */
export function AuthLayout({
  children,
  running = false,
  seconds,
}: {
  children: ReactNode;
  running?: boolean;
  seconds?: number;
}) {
  return (
    <div className="grid min-h-screen grid-cols-[repeat(auto-fit,minmax(360px,1fr))] bg-cream text-ink">
      <SpaceScene running={running} seconds={seconds} />
      <div className="relative flex flex-col justify-center px-[clamp(24px,6vw,96px)] py-[clamp(32px,6vw,88px)]">
        {children}
      </div>
    </div>
  );
}

/**
 * Full-page loading screen. Use for sign-in, sign-up and any dashboard load
 * long enough that a blank page would read as a failure.
 */
export function LoadingScene({
  kicker = "Signing in",
  title = "Bringing the center online.",
  steps = [
    "Authenticating credentials",
    "Syncing weekly performance data",
    "Preparing your dashboard",
  ],
  seconds = DEFAULT_SECONDS,
}: {
  kicker?: string;
  title?: string;
  steps?: [string, string, string] | string[];
  seconds?: number;
}) {
  const d = `${seconds}s`;

  return (
    <AuthLayout running seconds={seconds}>
      <div className="fade-up flex w-full max-w-[420px] flex-col gap-7">
        <PanelHeading kicker={kicker} title={title} />

        <div
          role="progressbar"
          aria-label={title}
          className="relative h-1.5 bg-line"
        >
          <div
            className="absolute inset-0 w-0 bg-orange-brand"
            style={{ animation: `bar ${d} cubic-bezier(.45,0,.2,1) forwards` }}
          />
        </div>

        <ol className="m-0 flex list-none flex-col gap-3.5 p-0 text-[15px] font-semibold">
          {steps.slice(0, 3).map((step, i) => (
            <li
              key={step}
              style={{
                opacity: i === 0 ? undefined : 0.3,
                animation: `step${i + 1} ${d} linear forwards`,
              }}
            >
              <span className="mr-3.5 inline-block h-2 w-2 bg-orange-brand align-middle" />
              {step}
            </li>
          ))}
        </ol>
      </div>
    </AuthLayout>
  );
}

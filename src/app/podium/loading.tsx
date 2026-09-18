import { Sky } from "./sky";

/**
 * What the podium shows while the month's scorecards are being computed.
 *
 * The same sky and the same line the scene's own first beat carries, so a
 * cold cache reads as the opening of the animation rather than as a page
 * that has not arrived. That first scene is called "Liftoff" in the
 * handoff and its caption is literally "Calculating this month's top
 * performers…" — the wait and the choreography want to say the same thing.
 */
export default function PodiumLoading() {
  return (
    <main className="relative flex h-dvh w-full items-center justify-center overflow-hidden bg-navy-900 font-sans">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% -10%, var(--navy-700), var(--navy-900) 60%)" }}
      />
      <Sky />
      <p className="relative z-10 px-6 text-center text-[15px] font-semibold text-cream sm:text-[22px]">
        Calculating this month&rsquo;s top performers&hellip;
      </p>
    </main>
  );
}

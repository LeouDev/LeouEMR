"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { AstronautFigure } from "@/components/astronaut-figure";
import type { PodiumPerson, TopPerformers } from "@/lib/queries/top-performers";
import {
  CONFETTI_SECONDS,
  CONFETTI_START,
  CONTROLS_SECONDS,
  CUE,
  FLY_SECONDS,
  GAP,
  ORDER,
  PLACE,
  POP_DELAY,
  POP_SECONDS,
  READY_AT,
  RISE_DELAY,
  RISE_SECONDS,
} from "./cues";
import { placeholderFace } from "./faces";
import { Sky } from "./sky";

/**
 * The top-performers podium: the month's top three agents and top three
 * supervisors on a cosmic podium, shown once per browser session after
 * sign-in.
 *
 * Rebuilt natively from the supplied prototype rather than ported: that
 * one runs on a composition engine that drives every frame from React
 * state, which is the wrong shape for a page four hundred people load at
 * shift start. The choreography is the same to the tenth of a second —
 * the cue table below is the handoff's timeline — but it is carried by CSS
 * animations that the compositor owns, so the whole scene costs one render.
 *
 * Geometry is kept in the handoff's own 1920x1080 reference units and
 * turned into pixels by `--u`, one scale factor for the whole composition.
 * That keeps the proportions the design settled on exactly, while still
 * sizing to the viewport it actually lands in — a hand-converted set of
 * rems would have drifted from the reference the first time anything moved.
 */

const EASE_OUT_CUBIC = "cubic-bezier(.22,.61,.36,1)";
const EASE_OUT_BACK = "cubic-bezier(.34,1.56,.64,1)";

/**
 * One scale factor for the whole composition: the smaller of what the
 * width allows and what the height allows, never above 1 (the reference
 * size is the largest this is meant to be) and never so small that the
 * scene collapses. The reserved 300 units of height are the title block
 * and the controls, which sit outside the podium's own 700.
 */
const SCALE: CSSProperties = {
  "--u": "clamp(0.3px, min(calc((100vw - 48px) / 1040), calc((100vh - 300px) / 700)), 1px)",
} as CSSProperties;

/** Reference units as a CSS length. */
function u(n: number): string {
  return `calc(${n} * var(--u))`;
}

/**
 * A timed entrance: name, duration, easing and start, all as custom
 * properties for `.pod-timed` to assemble. Never an inline
 * `animation-delay` — globals.css kills inline animation under reduced
 * motion, and that rule would take the podium's resting frame with it.
 */
function timed(anim: string, dur: number, delay: number, ease = EASE_OUT_CUBIC): CSSProperties {
  return { "--anim": anim, "--dur": `${dur}s`, "--d": `${delay}s`, "--ease": ease } as CSSProperties;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION);
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function reducedMotionNow(): boolean {
  return window.matchMedia?.(REDUCED_MOTION).matches ?? false;
}

/**
 * Whether this person has asked their system for less motion, read as an
 * external store rather than latched into state from an effect.
 *
 * The server has no media queries, so it renders the ordinary scene and the
 * client corrects on hydration; subscribing also means someone who changes
 * the setting mid-scene is obeyed rather than ignored until a reload.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, () => false);
}

export function PodiumIntro({ data }: { data: TopPerformers }) {
  const router = useRouter();
  const [tab, setTab] = useState<"agents" | "supervisors">("agents");
  const [skipped, setSkipped] = useState(false);
  const [settled, setSettled] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  // Anyone who asked for less motion gets the resting frame and a usable
  // page at once — there is nothing in the choreography they would
  // otherwise miss. Everyone else gets there by skipping or by waiting.
  //
  // The ordinary timeline must NOT set `held`: shifting the delays while
  // the controls are still sliding in would snap them into place instead of
  // letting them finish.
  const held = skipped || reducedMotion;
  const ready = settled || reducedMotion;
  // Past this point every entrance has finished, so freezing the timeline
  // costs nothing and fixes the one case that would otherwise look broken:
  // switching tabs mounts a pedestal in a slot the other tab left empty,
  // and a freshly mounted element starts its delay from NOW — it would sit
  // blank for three seconds and then animate in beside two that are already
  // standing. Held, it simply appears, which is what the handoff asks a tab
  // switch to do.
  const atRest = held || ready;

  // A fallback for the controls becoming live, behind the `animationend`
  // below.
  //
  // Measured from when the page started loading, NOT from when this effect
  // runs. The CSS clock starts at first paint and this one at hydration,
  // and on a cold serverless instance those are seconds apart — timed from
  // here, the controls would sit on screen looking pressable while a
  // `pointer-events: none` they cannot see swallows every click. Anything
  // already elapsed is time already served.
  useEffect(() => {
    if (reducedMotion) return;
    const remaining = Math.max(0, READY_AT * 1000 - performance.now());
    const timer = setTimeout(() => setSettled(true), remaining);
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  const people = tab === "agents" ? data.agents : data.supervisors;
  const hasSupervisors = data.supervisors.length > 0;
  const month = useMemo(
    () =>
      new Date(`${data.monthStart}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    [data.monthStart],
  );

  function skip() {
    setSkipped(true);
    setSettled(true);
  }

  function toDashboard() {
    setLeaving(true);
    router.push("/dashboard");
  }

  return (
    <main
      data-podium-held={atRest ? "1" : "0"}
      style={SCALE}
      className="relative flex h-dvh w-full flex-col items-center overflow-hidden bg-navy-900 font-sans"
    >
      {/* The ground the whole scene sits on, lit from above the podium. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% -10%, var(--navy-700), var(--navy-900) 60%)" }}
      />
      <Sky />

      <header
        className="pod-timed relative z-10 px-6 pt-[clamp(20px,5vh,64px)] text-center"
        style={timed("pod-drop-in", 0.8, 0)}
      >
        <p className="text-[11px] font-bold tracking-[0.2em] text-orange-brand-light uppercase sm:text-[15px]">
          This month&rsquo;s top performers
        </p>
        <h1 className="mt-1.5 text-[26px] leading-none font-extrabold tracking-[-0.01em] text-cream sm:text-[44px]">
          {tab === "agents" ? "Top agents" : "Top supervisors"}
        </h1>
        <p className="mt-2 text-[12px] text-cream/55 sm:text-[15px]">
          {month} &middot;{" "}
          {tab === "agents"
            ? "Ranked on the monthly scorecard score"
            : "Ranked on their team's mean scorecard score"}
        </p>
      </header>

      {/* The holding beat before the podium arrives, over the middle of the
          scene rather than in the layout flow — it has to leave without
          shifting anything that follows it. */}
      <p
        className="pod-timed pointer-events-none absolute top-[46%] z-10 px-6 text-center text-[15px] font-semibold text-cream sm:text-[22px]"
        style={timed("pod-caption", CUE.rise, 0, "linear")}
      >
        Calculating this month&rsquo;s top performers&hellip;
      </p>

      <div className="relative z-10 flex flex-1 items-end justify-center">
        <div className="flex items-end" style={{ gap: u(GAP) }}>
          {ORDER.map((place) => {
            const person = people.find((p) => p.place === place);
            return person ? (
              <Pedestal key={place} person={person} kind={tab} />
            ) : (
              // A month can hand back fewer than three scored people. The
              // column still holds its ground so the podium keeps its shape
              // rather than sliding the winner off centre.
              <div key={place} style={{ width: u(PLACE[place].width) }} />
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={skip}
        className="pod-timed absolute top-5 right-5 z-20 border-2 border-cream px-4 py-2 text-[12px] font-bold tracking-[0.08em] text-cream uppercase transition hover:border-orange-brand hover:text-orange-brand sm:top-8 sm:right-10 sm:px-5 sm:py-2.5 sm:text-sm"
        style={{
          ...timed("pod-fade-out", 0.3, CUE.hold - 0.3, "linear"),
          // Gone from the tab order the moment it is gone from the screen.
          visibility: ready ? "hidden" : "visible",
        }}
        tabIndex={ready ? -1 : 0}
      >
        Skip
      </button>

      {/* In the column rather than over it: floating these put the tab
          switcher across the first-place pedestal the moment the viewport
          was shorter than the reference frame. */}
      <div
        className="pod-timed relative z-20 flex shrink-0 flex-col items-center gap-4 pt-6 pb-[clamp(20px,5vh,56px)] sm:gap-6"
        style={{ ...timed("pod-sink-in", CONTROLS_SECONDS, CUE.hold), pointerEvents: ready ? "auto" : "none" }}
        // The exact moment these finish arriving, whatever the CSS clock
        // and this component's own clock think of each other.
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setSettled(true);
        }}
      >
        {hasSupervisors && (
          <div className="flex border-2 border-cream">
            {(["agents", "supervisors"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
                className={`px-4 py-2.5 text-[12px] font-bold tracking-[0.06em] uppercase transition sm:px-7 sm:py-3 sm:text-sm ${
                  tab === key ? "bg-orange-brand text-cream" : "text-cream hover:bg-navy-700"
                }`}
              >
                {key === "agents" ? "Top agents" : "Top supervisors"}
              </button>
            ))}
          </div>
        )}
        {/* The arrow is `.btn-primary`'s own ::after — the app's convention,
            and adding one here would print two. */}
        <button type="button" onClick={toDashboard} disabled={leaving} className="btn-primary px-8 py-3.5 text-sm sm:px-10">
          {leaving ? "Opening dashboard…" : "Continue to dashboard"}
        </button>
      </div>
    </main>
  );
}

/** One place: the pedestal, the figure standing on it, and the name above. */
function Pedestal({ person, kind }: { person: PodiumPerson; kind: "agents" | "supervisors" }) {
  const place = person.place;
  const { width, height, photo } = PLACE[place];
  const rise = timed("pod-rise", RISE_SECONDS, CUE.rise + RISE_DELAY[place], EASE_OUT_CUBIC);
  const pop = timed("pod-pop", POP_SECONDS, CUE.reveal + POP_DELAY[place], EASE_OUT_BACK);
  // Gold, silver, bronze in this palette's own terms: the brand orange for
  // first, the rule grey for second, the lighter orange for third.
  const ring = place === 1 ? "var(--orange-500)" : place === 2 ? "#c9ced6" : "var(--orange-400)";

  return (
    <div className="flex flex-col items-center" style={{ width: u(width) }}>
      <div
        className="pod-timed text-center"
        style={{ ...pop, maxWidth: u(width * 1.45), marginBottom: u(18) }}
      >
        <span
          className="inline-block border-2 border-cream bg-navy-700 font-bold text-cream"
          style={{ padding: `${u(4)} ${u(14)}`, fontSize: u(place === 1 ? 16 : 13), lineHeight: 1.25 }}
        >
          {person.name}
        </span>
      </div>

      <div className="pod-timed relative" style={{ ...pop, width: u(photo * 1.3), height: u(photo * 1.94) }}>
        {place === 1 && <Confetti photo={photo} />}
        {place === 1 && <Mascot photo={photo} />}
        <Figure photo={photo} person={person} ring={ring} />
      </div>

      {/* The pedestal itself: open at the bottom, so it reads as standing on
          the ground rather than floating above it. */}
      <div
        className="pod-timed relative w-full border-2 border-b-0 border-cream bg-navy"
        style={{ ...rise, height: u(height), "--rise": u(height + 60) } as CSSProperties}
      >
        <div
          aria-hidden
          className="absolute right-0 left-0 text-center font-extrabold text-cream/[0.06]"
          style={{ bottom: u(84), fontSize: u(width * 0.22), lineHeight: 1 }}
        >
          {String(place).padStart(2, "0")}
        </div>
        <div className="pod-timed absolute right-0 left-0 text-center" style={{ ...pop, bottom: u(18) }}>
          <div
            className="font-extrabold tracking-[-0.02em] text-orange-brand-light tabular-nums"
            style={{ fontSize: u(place === 1 ? 56 : 42), lineHeight: 1 }}
          >
            {person.score.toFixed(2)}
          </div>
          <div
            className="font-semibold tracking-[0.08em] text-cream/70 uppercase"
            style={{ fontSize: u(13), marginTop: u(4) }}
          >
            {kind === "agents" ? "Scorecard score" : `Team average of ${person.teamSize ?? 0}`}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The figure standing on the pedestal: a helmet for a head, a suited body
 * below it, feet planted on the pedestal top.
 *
 * Proportions are the reference's, all derived from the photo diameter.
 * The suit greys are the mascot's own (#eef0f3, #c9ced6 from
 * astronaut-figure.tsx) rather than the prototype's near-identical pair,
 * so the three on the podium and the one hovering beside first place read
 * as the same suit.
 */
function Figure({ photo, person, ring }: { photo: number; person: PodiumPerson; ring: string }) {
  const place = person.place;
  const bodyW = photo * 0.82;
  const torsoH = photo * 0.5;
  const legsH = photo * 0.4;
  const bootsH = photo * 0.14;
  const torsoTop = photo * 0.9;

  const centred: CSSProperties = { left: "50%", transform: "translateX(-50%)", position: "absolute" };

  return (
    <>
      <div style={{ ...centred, top: u(torsoTop), width: u(bodyW), height: u(torsoH), background: "#eef0f3" }}>
        <div
          className="absolute right-0 left-0 bg-orange-brand"
          style={{ top: u(torsoH * 0.55), height: u(torsoH * 0.14) }}
        />
      </div>
      <div
        className="absolute"
        style={{
          left: `calc(50% - ${u(bodyW * 0.72)})`,
          top: u(torsoTop + torsoH * 0.08),
          width: u(bodyW * 0.24),
          height: u(torsoH * 0.75),
          background: "#c9ced6",
        }}
      />
      <div
        className="absolute"
        style={{
          left: `calc(50% + ${u(bodyW * 0.48)})`,
          top: u(torsoTop + torsoH * 0.08),
          width: u(bodyW * 0.24),
          height: u(torsoH * 0.75),
          background: "#c9ced6",
        }}
      />
      <Legs bodyW={bodyW} top={torsoTop + torsoH} legsH={legsH} bootsH={bootsH} />

      {/* The head last, so it sits over the torso's top edge. */}
      <div style={{ ...centred, top: 0, width: u(photo), height: u(photo) }}>
        <div
          className="relative h-full w-full overflow-hidden"
          style={{
            borderRadius: "50%",
            border: `${u(4)} solid ${ring}`,
            boxShadow: `0 0 0 ${u(6)} var(--navy-900)`,
          }}
        >
          <PodiumFace person={person} />
        </div>
        <div
          className="absolute flex items-center justify-center font-extrabold text-cream"
          style={{
            right: u(-6),
            bottom: u(-6),
            width: u(40),
            height: u(40),
            borderRadius: "50%",
            background: place === 1 ? "var(--orange-500)" : "var(--navy-700)",
            border: `${u(2)} solid var(--navy-900)`,
            fontSize: u(18),
          }}
        >
          {place}
        </div>
      </div>
    </>
  );
}

function Legs({ bodyW, top, legsH, bootsH }: { bodyW: number; top: number; legsH: number; bootsH: number }) {
  const legW = bodyW * 0.36;
  const bootW = bodyW * 0.4;
  return (
    <>
      {[-1, 1].map((side) => (
        <div key={side} className="contents">
          <div
            className="absolute"
            style={{
              left: `calc(50% + ${u(side * bodyW * 0.26 - legW / 2)})`,
              top: u(top),
              width: u(legW),
              height: u(legsH),
              background: "#eef0f3",
            }}
          />
          <div
            className="absolute bg-orange-brand"
            style={{
              left: `calc(50% + ${u(side * bodyW * 0.26 - bootW / 2)})`,
              top: u(top + legsH),
              width: u(bootW),
              height: u(bootsH),
            }}
          />
        </div>
      ))}
    </>
  );
}

/**
 * The face in the helmet ring: this person's own profile picture where they
 * have uploaded one, and an illustrated stand-in where they have not.
 *
 * `photoVersion` decides, and it comes off the same cached computation that
 * put them on the podium — so a person without a picture never costs a
 * request that could only 404, and a person with one gets a URL that
 * changes when they replace it.
 *
 * Both keep their colour. A profile picture is already the app's standing
 * exception to "photography and avatars are grayscale" (see
 * profile-panel.tsx), and a podium of grey faces inside an orange ring was
 * the wrong place to start applying the rule instead.
 *
 * The alt text is empty on purpose. The name is on a tag directly above the
 * picture, so naming the person again here would read them out twice.
 */
function PodiumFace({ person }: { person: PodiumPerson }) {
  const src =
    person.photoId && person.photoVersion !== null
      ? `/podium/avatar/${person.photoId}?v=${person.photoVersion}`
      : placeholderFace(person.photoId ?? person.name);

  return (
    // A route handler's response or a file cropped square ahead of time —
    // neither something next/image could usefully optimise, and both
    // already sized to the frame they fill.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" data-keep-color className="h-full w-full object-cover" />
  );
}

/** The burst that fires as first place lands. */
function Confetti({ photo }: { photo: number }) {
  const bits = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    return {
      tx: Math.cos(angle) * 210,
      ty: Math.sin(angle) * 150 - 40,
      size: 6 + (i % 3) * 2,
      orange: i % 2 === 0,
    };
  });
  return (
    <div aria-hidden className="pointer-events-none absolute" style={{ left: "50%", top: u(photo * 0.5) }}>
      {bits.map((bit, i) => (
        <span
          key={i}
          className={`pod-timed absolute block ${bit.orange ? "bg-orange-brand" : "bg-cream"}`}
          style={
            {
              ...timed("pod-confetti", CONFETTI_SECONDS, CONFETTI_START, EASE_OUT_CUBIC),
              width: u(bit.size),
              height: u(bit.size),
              "--tx": u(bit.tx),
              "--ty": u(bit.ty),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * The app's mascot, flying in from off the top-left to hover beside first
 * place and then settling into an idle hop. Reused from
 * astronaut-figure.tsx rather than redrawn, per the handoff.
 */
function Mascot({ photo }: { photo: number }) {
  return (
    <div
      aria-hidden
      className="pod-timed pointer-events-none absolute"
      style={
        {
          ...timed("pod-fly-in", FLY_SECONDS, CUE.celebrate, EASE_OUT_CUBIC),
          left: `calc(100% + ${u(10)})`,
          top: u(photo * 0.26),
          "--fx": u(-1100),
          "--fy": u(-620),
        } as CSSProperties
      }
    >
      <div className="pod-loop-bob">
        <svg viewBox="-13 -6 26 41" style={{ width: u(46), height: u(72) }}>
          <AstronautFigure />
        </svg>
      </div>
    </div>
  );
}

/**
 * The podium's choreography and geometry, in one place.
 *
 * Its own module with no "use client" directive, for the reason spelled
 * out in dashboard/kpi-groups.ts and team/columns.ts: a value imported
 * across that boundary arrives as a reference proxy rather than the value.
 * Nothing here is read from a server component today, but keeping the
 * numbers neutral also lets them be tested without pulling a whole
 * animated scene into the test run.
 *
 * The scene lengths are the handoff's own timeline. The cue starts below
 * are their running total, and `cues.test.ts` holds the two to each other
 * so a retimed scene cannot silently leave a cue behind.
 */

/** Each scene's playing time, in seconds, in order. */
export const SCENES = [
  { name: "Liftoff", seconds: 1.4 },
  { name: "Countdown", seconds: 1.0 },
  { name: "Rise", seconds: 2.0 },
  { name: "Reveal", seconds: 2.2 },
  { name: "Celebrate", seconds: 1.6 },
  { name: "Hold", seconds: 6.0 },
] as const;

/** When each scene starts, in seconds from the first frame. */
export const CUE = { rise: 2.4, reveal: 4.4, celebrate: 6.6, hold: 8.2 } as const;

/** Third place leads, then second, then first — the order the design reveals them in. */
export const RISE_DELAY: Record<number, number> = { 3: 0, 2: 0.35, 1: 0.7 };
export const POP_DELAY: Record<number, number> = { 3: 0, 2: 0.4, 1: 0.8 };

/** How long one pedestal takes to rise, and one person to pop in. */
export const RISE_SECONDS = 1.0;
export const POP_SECONDS = 0.55;
/** The mascot's flight, and the burst that fires as first place lands. */
export const FLY_SECONDS = 1.2;
export const CONFETTI_SECONDS = 2.0;
export const CONFETTI_START = CUE.reveal + POP_DELAY[1] + 0.1;

/** The controls are usable once their own entrance has finished, not the moment it starts. */
export const CONTROLS_SECONDS = 0.5;
export const READY_AT = CUE.hold + CONTROLS_SECONDS;

/** Pedestal and photo sizes in the handoff's 1920x1080 reference units, per place. */
export const PLACE: Record<number, { width: number; height: number; photo: number }> = {
  1: { width: 300, height: 300, photo: 180 },
  2: { width: 240, height: 220, photo: 140 },
  3: { width: 240, height: 180, photo: 140 },
};

/** Classic podium order, left to right: second, first, third. */
export const ORDER = [2, 1, 3];
/** Reference units between one pedestal and the next. */
export const GAP = 60;

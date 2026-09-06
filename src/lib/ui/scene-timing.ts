/** How long the auth loading scene runs, in seconds. Matches the reference. */
export const SCENE_SECONDS = 6;

/**
 * How much longer the loading scene should stay up.
 *
 * Auth usually resolves in a few hundred milliseconds — far inside the
 * animation — so without this the scene flashes and vanishes. Returns the
 * milliseconds still owed to the animation, or 0 when it has already had
 * its full run.
 *
 * Anyone who has asked the system to reduce motion has no animation to
 * watch, so they are never made to wait for one.
 */
export function remainingSceneMs(
  startedAt: number,
  now: number,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) return 0;
  return Math.max(0, SCENE_SECONDS * 1000 - (now - startedAt));
}

/** True when the viewer has asked the system to reduce motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Resolves once the scene has had its full run. */
export function holdForScene(startedAt: number): Promise<void> {
  const remaining = remainingSceneMs(startedAt, Date.now(), prefersReducedMotion());
  return remaining > 0
    ? new Promise((resolve) => setTimeout(resolve, remaining))
    : Promise.resolve();
}

/**
 * The illustrated stand-ins for someone who has not uploaded a profile
 * picture, and how one is chosen.
 *
 * **Not chosen by gender**, and this is deliberate. The prototype picked
 * between these two by a `gender` field; this app holds no such field on
 * an employee or a user, and the only thing available to guess one from is
 * a person's name. A guess from a name is wrong often enough that it would
 * put the wrong drawing beside somebody's name on a screen the whole
 * company sees at sign-in — a worse outcome than an arbitrary pick, and
 * one nobody could correct.
 *
 * So the pick is arbitrary but stable: the same person always gets the same
 * drawing, and the two are spread evenly across the roster. Anyone who
 * would rather be represented by their own face already has the way to do
 * it — upload a profile picture, which the podium shows in preference to
 * anything here.
 */

/** Sitting in `public/podium/`, cropped square and already sized for the frame. */
export const PLACEHOLDER_FACES = ["/podium/astronaut-a.webp", "/podium/astronaut-b.webp"] as const;

/**
 * FNV-1a, 32-bit. Any small stable hash would do; what matters is that the
 * server and the browser compute the same one from the same key, so the
 * picture does not change between the rendered HTML and the hydrated page.
 */
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Which stand-in to draw for `key` — an employee id where there is one, and
 * otherwise the person's name, both stable for as long as they are on a
 * podium.
 */
export function placeholderFace(key: string): string {
  return PLACEHOLDER_FACES[hash(key) % PLACEHOLDER_FACES.length];
}

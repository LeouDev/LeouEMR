/**
 * Where an item page sends a reader back to.
 *
 * An item is reached from several places — the action items list, the
 * records list, an employee's own page, and the Development Hub roster —
 * and "back" should mean the one they came from. A reader three levels into
 * a roster who follows a failing figure and is then returned to the top of
 * a list has lost their place, which is the whole complaint.
 *
 * The page that linked here says where it was in one word, and this turns
 * that word into a destination. Deliberately a token and not a URL: nothing
 * a caller puts in the query string ever reaches an href, so a crafted
 * `?from=` cannot aim the back link at another site, and an unknown one
 * simply falls back to the page's own default.
 */
export interface ReturnTo {
  href: string;
  label: string;
}

/** The token the Development Hub roster sends with every item link it draws. */
export const FROM_DEVELOPMENT = "development";

/**
 * A Map rather than an object literal, which is not a detail. An object's
 * prototype answers for keys nobody put in it: `?from=constructor` reads
 * back a function, and the back link renders with no href and no label. A
 * Map has no such chain, so an unknown token is simply unknown.
 */
const RETURNS = new Map<string, ReturnTo>([
  [FROM_DEVELOPMENT, { href: "/development", label: "← Back to the development hub" }],
]);

export function returnTo(from: string | undefined, fallback: ReturnTo): ReturnTo {
  if (!from) return fallback;
  return RETURNS.get(from) ?? fallback;
}

/** `href` with the token appended, keeping any fragment after the query. */
export function withReturn(href: string, from: string | undefined): string {
  if (!from) return href;
  const [path, fragment] = href.split("#");
  const query = `${path.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}`;
  return `${path}${query}${fragment ? `#${fragment}` : ""}`;
}

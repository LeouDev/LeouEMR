/**
 * Reading the session Supabase stores in cookies without going through the
 * auth client — for the one case where the client's own reading would do
 * too much.
 *
 * The client refreshes an expired token whenever it reads the session, and
 * refresh tokens are single-use: a burst of prefetches all refreshing at
 * once rotate the token out from under each other, which used to bounce a
 * signed-in person to the login page. So the middleware verifies a
 * prefetch's token as it is — signature and expiry, no refresh — and only
 * a real navigation refreshes. That needs the raw access token, which the
 * SSR client keeps as JSON in a cookie named after the project, split into
 * numbered chunks when long and base64url-encoded behind a "base64-" prefix.
 */

/** A prefetch: the background load a visible link triggers, never a click. */
export function isPrefetchRequest(headers: Headers): boolean {
  return headers.has("next-router-prefetch") || headers.get("purpose") === "prefetch";
}

/** The cookie the SSR client uses for this project: `sb-<ref>-auth-token`. */
export function sessionCookieName(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    return ref ? `sb-${ref}-auth-token` : null;
  } catch {
    return null;
  }
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The chunks of one cookie, joined in order; null when there is none. */
function combined(cookies: ReadonlyArray<{ name: string; value: string }>, name: string): string | null {
  const whole = cookies.find((c) => c.name === name);
  if (whole) return whole.value;
  const chunks = cookies
    .map((c) => ({ index: c.name.startsWith(`${name}.`) ? Number(c.name.slice(name.length + 1)) : NaN, value: c.value }))
    .filter((c) => Number.isInteger(c.index))
    .sort((a, b) => a.index - b.index);
  return chunks.length ? chunks.map((c) => c.value).join("") : null;
}

/** The access token in the session cookie, or null when there is no readable one. */
export function accessTokenFromCookies(
  cookies: ReadonlyArray<{ name: string; value: string }>,
  supabaseUrl: string | undefined,
): string | null {
  const name = sessionCookieName(supabaseUrl);
  if (!name) return null;
  const raw = combined(cookies, name);
  if (!raw) return null;
  try {
    const json = raw.startsWith("base64-") ? fromBase64Url(raw.slice("base64-".length)) : decodeURIComponent(raw);
    const session = JSON.parse(json) as { access_token?: unknown };
    return typeof session.access_token === "string" && session.access_token ? session.access_token : null;
  } catch {
    return null;
  }
}

/** A JWT's payload, unverified — only for claims on a token something else has already verified. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(fromBase64Url(parts[1])) as unknown;
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

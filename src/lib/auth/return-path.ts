/**
 * Where to send someone after they sign in.
 *
 * The login page carries the page they were trying to reach as a `next`
 * parameter, which the middleware sets to a path on this site. Anyone can
 * write a link with a different value, so only a same-site path is
 * honoured: anything that could leave the site (a full URL, a
 * protocol-relative "//host", a backslash variant) falls back to the
 * dashboard.
 */
export function safeReturnPath(candidate: string | null | undefined, fallback = "/dashboard"): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\s]/.test(candidate)) return fallback;
  return candidate;
}

/**
 * What to tell someone when a server action THREW rather than returning
 * `{ ok: false, error }`.
 *
 * Every action in this app returns its refusals as a value, so a throw only
 * ever means something outside the action's own logic gave out: the network
 * dropped mid-request, the deploy was mid-rollover, the database round trip
 * timed out, or the function hit its platform time limit. None of those come
 * with a message worth showing verbatim (Next.js deliberately replaces a
 * production server error's text with an opaque digest), and before this
 * existed most forms did not catch the throw at all — the button stayed on
 * "Saving…" forever with nothing to say why, which reads as the app having
 * hung rather than as something to retry.
 */
export function describeActionError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  // Fetch's own wording for a connection that never completed, in the
  // browsers this runs in.
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return "Could not reach the server — check your connection and try again.";
  }
  return "Something went wrong saving that. Nothing was changed — please try again in a moment.";
}

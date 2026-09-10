import { revalidateTag, unstable_cache } from "next/cache";

/**
 * Cache tags, one per thing that can make a cached read stale.
 *
 * Almost everything expensive this app reads changes only when an
 * administrator does something explicit — imports a workbook or a
 * masterlist, sets a ramp, edits a skill target. Between those moments a
 * month's numbers are the same for every viewer, yet each page load was
 * re-aggregating them from the fact tables and re-reading the same
 * reference rows over a cross-region connection. Tagging lets those
 * explicit writes evict exactly what they changed, immediately, and
 * nothing else.
 */
export const CACHE_TAG = {
  /** Facts, weekly results, employees, assignments — everything an import writes. */
  imports: "imports",
  /** Skill references, aliases and KPI definitions — the scoring configuration. */
  reference: "reference",
  /** Ramp schedules and per-employee ramp assignments. */
  ramp: "ramp",
  /** EWS assessments — they carry the separation dates that decide who counts in a period. */
  ews: "ews",
  /** Performance issues and action items — their statuses feed the open-work counts. */
  issues: "issues",
} as const;

/**
 * Longest a cached read may outlive the last write that made it stale.
 *
 * The app's own writes invalidate their tags on the spot (see
 * `invalidateCache`). The one thing that cannot is a maintenance script run
 * from the command line (`npm run reevaluate`, `reset:imports`, …), which
 * writes to the same tables outside any request. This bounds how long such
 * a run can go unnoticed by the pages: ten minutes, chosen because those
 * scripts are rare, run by the person who then checks the result, and a
 * redeploy also clears everything.
 */
export const CACHE_SAFETY_SECONDS = 600;

/**
 * Wraps a read so its result is shared across requests and instances until
 * one of `tags` is invalidated (or the safety window lapses).
 *
 * The wrapped function's result is serialised as JSON, so it must return
 * plain data — arrays and objects, never a Map, Set or Date. Build those
 * from the cached rows at the call site instead. It also must not touch
 * request state (`headers()`, `cookies()`, the current user): pass anything
 * request-specific in as an argument, which then becomes part of the key.
 */
export function cachedRead<A extends unknown[], R>(
  name: string,
  tags: string[],
  read: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  // Only the Next.js server has a cache to put this in. The same loaders
  // are imported by the command-line scripts under scripts/ (which run
  // through tsx, with no Next runtime) and by the unit tests, and
  // `unstable_cache` throws outside a Next request rather than falling
  // through — so anywhere else this is simply the read itself.
  if (!process.env.NEXT_RUNTIME) return read;
  return unstable_cache(read, [name], { tags, revalidate: CACHE_SAFETY_SECONDS });
}

/**
 * Evicts every cached read carrying any of `tags`, so the very next request
 * recomputes it — no stale-while-revalidate window: someone who has just
 * imported a week expects the next page they open to show it.
 *
 * Only callable from a Server Action or Route Handler (Next's rule for
 * `revalidateTag`); never from library code a command-line script might
 * also import.
 */
export function invalidateCache(...tags: string[]): void {
  // Nothing is cached outside the Next.js server (see cachedRead), so
  // there is nothing to evict there either — and `revalidateTag` throws
  // outside a request.
  if (!process.env.NEXT_RUNTIME) return;
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Longest a queued computation waits for its predecessor before running
 * anyway. A predecessor that has not finished in this long is stuck — a
 * query hung on the pooler, say — and letting it hold the queue would turn
 * one stuck request into every later request on this instance hanging
 * too. Each of these computations is measured in seconds, not tens of
 * them, so the wait is only ever hit when something has already gone
 * wrong; it is logged so that shows up.
 */
export const QUEUE_STALL_MS = 30_000;

function afterPredecessor(prior: Promise<unknown>, queue: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(
        `[cache] the "${queue}" queue's previous computation is still running after ${QUEUE_STALL_MS} ms; running the next one without waiting for it`,
      );
      resolve();
    }, QUEUE_STALL_MS);
    // Never the thing keeping a command-line script alive at exit.
    (timer as { unref?: () => void }).unref?.();
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    prior.then(done, done);
  });
}

/**
 * Runs `work` after everything previously queued under `queue` has
 * finished — one heavy computation at a time per server instance.
 *
 * Used inside the cached reads whose cold path fans out several queries at
 * once (an organisation-wide period aggregation, the analytics snapshot).
 * A cache hit never comes near this; only a miss queues. That is what lets
 * a page request all of its cached reads together: warm reads resolve in
 * parallel, and the rare misses still never run two heavy fan-outs against
 * the pool at once — the wedge described in src/lib/db/client.ts. Separate
 * queues for computations that nest (analytics calls period metrics) so a
 * caller is never waiting on itself.
 *
 * The wait for a predecessor is bounded (see QUEUE_STALL_MS): the queue
 * lives as long as the server instance, and an unbounded wait behind one
 * computation that never finishes would hang every later request.
 */
export function serialized<T>(queue: string, work: () => Promise<T>): Promise<T> {
  const prior = queues.get(queue) ?? Promise.resolve();
  const run = afterPredecessor(prior, queue).then(work);
  queues.set(queue, run.catch(() => undefined));
  return run;
}

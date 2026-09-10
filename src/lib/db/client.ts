import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { withQueryGate } from "./query-gate";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

let instance: Database | null = null;

/** Pooled connections per server instance, and the most queries in flight at once. */
const POOL_SIZE = 8;

/**
 * Creates the connection on first query rather than at import.
 *
 * A build imports every route module to analyse it, so throwing here at
 * module scope fails the whole build when DATABASE_URL is absent — which is
 * exactly the state of a first deploy before environment variables are set,
 * and the resulting error says nothing about the real cause. Deferring it
 * means the build succeeds and a genuinely missing variable surfaces on the
 * first request with a message that explains itself.
 */
function connect(): Database {
  if (instance) return instance;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Locally, copy .env.example to .env.local; " +
        "in production, set it in the hosting platform's environment variables.",
    );
  }

  /**
   * `prepare: false` is required for Supabase's transaction-mode pooler
   * (port 6543), which production uses — session mode holds a connection per
   * client and runs out under serverless concurrency.
   *
   * postgres-js does not queue when every connection is busy: it pipelines
   * the extra query onto a busy connection, and the transaction pooler
   * does not tolerate that — with `max: 1` the first query succeeds and
   * every later one hangs forever behind a wedged connection. The pool
   * size only moves where that cliff sits. `withQueryGate` removes it:
   * queries beyond the pool size wait for a free connection instead of
   * being pipelined, so a burst (the manager dashboard issues up to ten
   * at once; under Fluid Compute several requests share this one pool)
   * queues briefly rather than hanging the request for good — the failure
   * that reached users as "Something went wrong loading this page".
   *
   * Eight connections keep the database's load where it was measured;
   * transaction pooling reuses server-side connections per statement, so
   * this costs far less than the same number would in session mode.
   */
  instance = drizzle(
    withQueryGate(
      postgres(url, {
        max: POOL_SIZE,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
      }),
      POOL_SIZE,
    ),
    { schema },
  );

  return instance;
}

/**
 * Behaves exactly like a Drizzle instance; the proxy only defers the
 * connection so call sites need no knowledge of the laziness.
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const real = connect();
    const value = Reflect.get(real, property, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

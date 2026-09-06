import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

let instance: Database | null = null;

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
   * Serverless platforms run many short-lived instances, each opening its
   * own pool, so a size that is fine locally exhausts the database's client
   * limit in production.
   *
   * `prepare: false` is required for Supabase's transaction-mode pooler
   * (port 6543), which production should use — session mode holds a
   * connection per client and runs out under serverless concurrency.
   */
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  instance = drizzle(
    postgres(url, {
      max: isServerless ? 1 : 4,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    }),
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

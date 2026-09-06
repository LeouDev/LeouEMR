import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required — copy .env.example to .env.local and fill it in");
}

/**
 * Serverless platforms run many short-lived instances, each opening its own
 * pool, so a pool size that is fine locally will exhaust the database's
 * client limit in production. One connection per instance is the standard
 * shape there; locally a handful is faster.
 *
 * `prepare: false` is required for Supabase's transaction-mode pooler
 * (port 6543), which is the port production should use — the session-mode
 * pooler holds a connection per client and runs out quickly under
 * serverless concurrency.
 */
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const queryClient = postgres(process.env.DATABASE_URL, {
  max: isServerless ? 1 : 4,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });

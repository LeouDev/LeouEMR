import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required — copy .env.example to .env.local and fill it in");
}

/**
 * Supabase's session-mode pooler allows a small number of clients, and the
 * dev server, scripts and serverless invocations all draw from it, so the
 * per-process pool is kept deliberately small. `prepare: false` keeps this
 * compatible with transaction-mode pooling too.
 */
const queryClient = postgres(process.env.DATABASE_URL, {
  max: 4,
  idle_timeout: 20,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });

import { z } from "zod";

const uuid = z.string().uuid();

/**
 * Whether a value from a URL is shaped like one of our ids.
 *
 * Every primary key here is a Postgres uuid, and comparing a uuid column
 * against a string that is not one does not return "no rows" — Postgres
 * raises a cast error, which surfaces as the generic "something went wrong"
 * page for what is really just a hand-edited or truncated link. Checked
 * once at the edge so a bad id becomes "not found" (or "no filter") instead.
 */
export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && uuid.safeParse(value).success;
}

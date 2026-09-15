/**
 * The part of a failed query worth showing someone.
 *
 * drizzle-orm wraps every failed query in a `DrizzleQueryError` whose own
 * message is the SQL followed by its bound parameters. For a bulk update
 * that is hundreds of UUIDs and no reason at all — the reason Postgres
 * gave sits in `cause`. An import that hit a constraint therefore reported
 * itself as a wall of parameters, both on the page and in the
 * `import_batches` row it saved, which is how one stayed unexplained.
 *
 * The constraint name is appended when Postgres named one and the message
 * does not already carry it: that name is what identifies the rule broken.
 * Postgres's DETAIL is deliberately left out — for a check violation it is
 * the entire failing row, which here means a named person's record, and
 * this string is persisted in validation_summary.
 */
export function describeDbError(error: unknown): string {
  const outer = error instanceof Error ? error : null;
  const real = outer?.cause instanceof Error ? outer.cause : outer;
  if (!real) return String(error);

  const constraint = (real as { constraint_name?: unknown }).constraint_name;
  return typeof constraint === "string" && constraint && !real.message.includes(constraint)
    ? `${real.message} (${constraint})`
    : real.message;
}

import { describe, expect, it } from "vitest";
import { describeDbError } from "./query-error";

/** Shaped like drizzle-orm's DrizzleQueryError: the SQL dump is the message, the reason is the cause. */
function drizzleQueryError(sql: string, params: string[], cause?: Error): Error {
  const error = new Error(`Failed query: ${sql}\nparams: ${params.join(",")}`);
  if (cause) error.cause = cause;
  return error;
}

describe("describeDbError", () => {
  it("reaches past the SQL dump for the reason Postgres gave", () => {
    const cause = Object.assign(
      new Error('new row for relation "employee_assignments" violates check constraint "employee_assignments_dates_ordered"'),
      { constraint_name: "employee_assignments_dates_ordered" },
    );
    const message = describeDbError(
      drizzleQueryError('update "employee_assignments" set "effective_to" = $1', ["2026-08-31"], cause),
    );

    expect(message).toContain("violates check constraint");
    expect(message).not.toContain("Failed query");
    expect(message).not.toContain("2026-08-31");
  });

  it("names the constraint when the message does not already", () => {
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), {
      constraint_name: "employee_assignments_no_overlap",
    });

    expect(describeDbError(drizzleQueryError("insert", [], cause))).toBe(
      "duplicate key value violates unique constraint (employee_assignments_no_overlap)",
    );
  });

  it("leaves Postgres's DETAIL out — for a check violation it is the failing person's row", () => {
    const cause = Object.assign(new Error("violates check constraint"), {
      constraint_name: "c",
      detail: "Failing row contains (uuid, 2026-09-01, 2026-08-31, Dela Cruz).",
    });

    expect(describeDbError(drizzleQueryError("update", [], cause))).not.toContain("Dela Cruz");
  });

  it("falls back to the error itself when nothing wrapped it", () => {
    expect(describeDbError(new Error("connection terminated"))).toBe("connection terminated");
    expect(describeDbError("not an error")).toBe("not an error");
  });
});

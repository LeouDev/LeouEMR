import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { reportingWeekStart } from "./week-sql";

describe("reportingWeekStart", () => {
  it("renders the same three-way rule as weekContaining, with the cut-over dates bound", () => {
    const { sql: text, params } = new PgDialect().sqlToQuery(reportingWeekStart(sql`d`));
    expect(text.replace(/\s+/g, " ")).toBe(
      "(case when d >= $1::date then d - extract(dow from d)::int " +
        "when d >= $2::date then $3::date " +
        "else d - ((extract(dow from d)::int + 1) % 7) end)",
    );
    expect(params).toEqual(["2026-05-31", "2026-05-23", "2026-05-23"]);
  });

  it("cannot be repeated in a GROUP BY, which is why callers group by position", () => {
    // Two calls render character-for-character the same expression but bind
    // their dates under different numbers. Postgres matches a grouped
    // expression to a selected one structurally, reads $1 and $4 as two
    // different things, and rejects the query with "column must appear in
    // the GROUP BY clause" — a failure that only shows up against a real
    // database, which is what this pins. Group by the output position.
    const dialect = new PgDialect();
    const selected = dialect.sqlToQuery(reportingWeekStart(sql`d`));
    const grouped = dialect.sqlToQuery(
      sql`${reportingWeekStart(sql`d`)} , ${reportingWeekStart(sql`d`)}`,
    );

    expect(selected.sql).toContain("$1::date");
    // The second copy inside one statement is numbered on from the first.
    expect(grouped.sql).toContain("$4::date");
    expect(grouped.sql.indexOf("$1::date")).toBeGreaterThanOrEqual(0);
  });
});

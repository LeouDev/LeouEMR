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
});

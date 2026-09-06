-- Dated org-structure history.
--
-- `employees` keeps one current row per person, which is the right basis for
-- authorization and day-to-day work but keeps no history: a realignment
-- rewrites the past, moving last month's numbers to a supervisor who did not
-- earn them. This table records who someone reported to *during* a period, so
-- reporting roll-ups stay stable when the org changes.
--
-- The source workbook already carries the supervisor on every weekly row, so
-- this is populated from data the import previously discarded.
CREATE TABLE "employee_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "effective_from" date NOT NULL,
  -- NULL means "still current": the source never states an end date.
  "effective_to" date,
  "supervisor_eid" text,
  "supervisor_name" text,
  "manager_name" text,
  "site" text,
  "source_import_id" uuid REFERENCES "import_batches"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Covers the hot lookup: the assignment for one person on one date.
CREATE INDEX "employee_assignments_lookup_idx"
  ON "employee_assignments" ("employee_id", "effective_from", "effective_to");
--> statement-breakpoint
-- Roll-ups group by supervisor over a date window.
CREATE INDEX "employee_assignments_supervisor_idx"
  ON "employee_assignments" ("supervisor_eid", "effective_from");
--> statement-breakpoint
CREATE INDEX "employee_assignments_manager_idx"
  ON "employee_assignments" ("manager_name", "effective_from");
--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_dates_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");
--> statement-breakpoint
-- Two assignments must never cover the same day for the same person, or a
-- roll-up would count them twice. Enforced in the database so a bug in the
-- splice logic cannot quietly persist overlapping history.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_no_overlap"
  EXCLUDE USING gist (
    "employee_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );
--> statement-breakpoint
-- Backfill: everything already imported becomes one open interval carrying the
-- current structure, starting from that person's earliest measured week. It is
-- the honest statement of what is known — the previous import kept no history.
-- Re-importing past months refines this into real intervals.
INSERT INTO "employee_assignments"
  ("employee_id", "effective_from", "effective_to", "supervisor_eid", "supervisor_name", "manager_name", "site")
SELECT
  e."id",
  COALESCE(
    (SELECT MIN(w."week_start") FROM "weekly_metric_results" w WHERE w."employee_id" = e."id"),
    (SELECT MIN(f."fact_date") FROM "metric_facts" f WHERE f."employee_id" = e."id"),
    e."created_at"::date
  ),
  NULL,
  e."supervisor_eid",
  e."supervisor_name",
  e."manager_name",
  e."site"
FROM "employees" e;
--> statement-breakpoint
-- Same fail-closed baseline as every other table: RLS on, no policies, so the
-- data is reachable only through the server's own connection.
ALTER TABLE "employee_assignments" ENABLE ROW LEVEL SECURITY;

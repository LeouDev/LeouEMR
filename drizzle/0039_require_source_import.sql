-- Every performance row must name the import that produced it.
--
-- source_import_id was nullable, and nothing enforced it because nothing in
-- the application can write these tables except the import pipeline, which
-- always sets it. That held right up until sixteen rows were inserted
-- straight into the database: four weeks of identical values for a single
-- agent, with quality and NPS results that had no quality or NPS facts
-- underneath them.
--
-- They were not merely wrong numbers. The action-item engine advances an
-- issue on consecutive passing weeks, so four fabricated passing weeks
-- closed four real performance issues — attendance, quality, cases per hour
-- and NPS — and one of them was raised against a metric that agent had never
-- been measured on at all. A supervisor wrote an RCA and an action plan
-- against it, and the agent acknowledged it twice.
--
-- A null here was the only thing that distinguished those rows from real
-- ones, which is what made the cleanup possible. This makes the same rows
-- impossible to insert rather than merely findable afterwards: a direct
-- write now has to name an import batch that exists, and inventing one is a
-- deliberate act rather than an omission.
--
-- Safe to apply as-is: all six tables were verified to hold no null
-- source_import_id (138,774 rows) before this was written, and the import
-- pipeline is the sole writer of each.
ALTER TABLE "weekly_metric_results" ALTER COLUMN "source_import_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_facts" ALTER COLUMN "source_import_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_facts" ALTER COLUMN "source_import_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quality_facts" ALTER COLUMN "source_import_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "nps_facts" ALTER COLUMN "source_import_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_assignments" ALTER COLUMN "source_import_id" SET NOT NULL;

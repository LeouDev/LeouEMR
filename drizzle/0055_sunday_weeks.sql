-- Custom SQL migration file, put your code below! --

-- Reporting weeks run Sunday to Saturday from 31 May 2026
-- (src/lib/queries/period.ts). Every week key stored from that point was
-- written under the old Saturday-to-Friday grid and moves one day forward,
-- onto its Sunday. The week of Sat 23 May 2026 — the last old-grid week —
-- keeps its start and runs to Sat 30 May, so the two grids meet with no
-- gap and no one-day week. Daily facts (metric_facts, skill_facts,
-- quality_facts, nps_facts) carry their own dates and are untouched; a
-- re-import of each workbook with rows dated 30 May 2026 or later rebuilds
-- the weekly figures on the new grid from them.
--
-- Only Saturday-keyed values from 30 May 2026 on are touched, and a keyed
-- row is never moved onto a key that already exists, so a second run is a
-- no-op and a week already re-imported on the new grid is never overwritten.
UPDATE "weekly_metric_results" w SET "week_start" = w."week_start" + 1
 WHERE w."week_start" >= '2026-05-30' AND extract(dow from w."week_start") = 6
   AND NOT EXISTS (
     SELECT 1 FROM "weekly_metric_results" x
      WHERE x."employee_id" = w."employee_id" AND x."kpi_id" = w."kpi_id" AND x."week_start" = w."week_start" + 1);--> statement-breakpoint
UPDATE "weekly_metric_results" SET "week_end" = "week_start" + 6
 WHERE "week_start" >= '2026-05-31' AND extract(dow from "week_start") = 0 AND "week_end" <> "week_start" + 6;--> statement-breakpoint
UPDATE "weekly_metric_results" SET "week_end" = '2026-05-30'
 WHERE "week_start" = '2026-05-23' AND "week_end" = '2026-05-29';--> statement-breakpoint
UPDATE "performance_issues" SET "opened_week" = "opened_week" + 1
 WHERE "opened_week" >= '2026-05-30' AND extract(dow from "opened_week") = 6;--> statement-breakpoint
UPDATE "performance_issues" SET "last_evaluated_week" = "last_evaluated_week" + 1
 WHERE "last_evaluated_week" >= '2026-05-30' AND extract(dow from "last_evaluated_week") = 6;--> statement-breakpoint
UPDATE "performance_issues" SET "resolved_week" = "resolved_week" + 1
 WHERE "resolved_week" >= '2026-05-30' AND extract(dow from "resolved_week") = 6;--> statement-breakpoint
UPDATE "weekly_issue_history" h SET "week" = h."week" + 1
 WHERE h."week" >= '2026-05-30' AND extract(dow from h."week") = 6
   AND NOT EXISTS (
     SELECT 1 FROM "weekly_issue_history" x
      WHERE x."performance_issue_id" = h."performance_issue_id" AND x."week" = h."week" + 1);--> statement-breakpoint
UPDATE "rca_notes" SET "week" = "week" + 1
 WHERE "week" >= '2026-05-30' AND extract(dow from "week") = 6;--> statement-breakpoint
UPDATE "ews_assessments" e SET "week" = e."week" + 1
 WHERE e."week" >= '2026-05-30' AND extract(dow from e."week") = 6
   AND NOT EXISTS (
     SELECT 1 FROM "ews_assessments" x
      WHERE x."employee_id" = e."employee_id" AND x."week" = e."week" + 1);--> statement-breakpoint
UPDATE "employee_ramp_assignments" SET "ramp_start_week" = "ramp_start_week" + 1
 WHERE "ramp_start_week" >= '2026-05-30' AND extract(dow from "ramp_start_week") = 6;

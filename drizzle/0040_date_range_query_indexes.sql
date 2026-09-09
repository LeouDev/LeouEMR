-- Every period-scoped fact query filters primarily by a date range, then by
-- employee_id — but the existing composite indexes on these three tables all
-- lead with employee_id, kpi_id/skill_label, THEN the date column, which
-- Postgres cannot use for a date-range scan when the middle column isn't
-- also equality-filtered (leftmost-prefix rule). Confirmed via EXPLAIN
-- ANALYZE: a realistic one-month query on each table was doing a full
-- sequential scan (1.2-1.5s each, ~3.6s combined) despite the existing
-- indexes, because none of them are usable for "date BETWEEN x AND y"
-- without an equality filter on the column ahead of it.
CREATE INDEX IF NOT EXISTS "metric_facts_date_employee_idx" ON "metric_facts" USING btree ("fact_date","employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_facts_date_employee_idx" ON "skill_facts" USING btree ("fact_date","employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weekly_metric_results_week_employee_idx" ON "weekly_metric_results" USING btree ("week_start","employee_id");
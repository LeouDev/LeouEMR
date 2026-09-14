CREATE TABLE "monthly_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" date NOT NULL,
	"metric" text NOT NULL,
	"value" numeric NOT NULL,
	"source_import_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quality_facts" ADD COLUMN "score_sum" numeric DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_metrics" ADD CONSTRAINT "monthly_metrics_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_metrics" ADD CONSTRAINT "monthly_metrics_source_import_id_import_batches_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_metrics_employee_month_metric_idx" ON "monthly_metrics" USING btree ("employee_id","month","metric");--> statement-breakpoint
-- The monthly sheet's figures live in their own table; fail-closed like
-- every other public table, reachable only through the app role's policy
-- (scripts/sql/app-role.sql).
ALTER TABLE "monthly_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Standard (non-critical) compliance errors from the Feedback sheet's
-- Standard column. Daily facts only: the scorecard sums them over its own
-- six-month window, no weekly row is ever written, and it opens no action
-- items of its own.
insert into public.kpi_definitions
  (code, name, type, direction, target, warning_threshold, failure_threshold, generates_action_items, aggregation)
values
  ('STANDARD_ERRORS', 'Standard Errors', 'number', 'lower_is_better', 0, 0, 0, false, 'sum')
on conflict (code) do nothing;

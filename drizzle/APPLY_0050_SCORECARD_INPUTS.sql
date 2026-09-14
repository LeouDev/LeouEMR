-- One paste, one transaction: apply migration 0050 (the scorecard's
-- import inputs), give the app role its policy on the new table (what
-- re-running scripts/sql/app-role.sql would do), and record the migration
-- in drizzle's tracker, the way this project applies migrations to
-- production (the Supabase SQL editor as postgres). Safe to run twice:
-- every statement is guarded, and the tracker insert is too.

begin;

-- The audits' scores added up per skill and day, so phone and ancillary
-- quality can be rated separately (score_sum / audits is the mean). Filled
-- by the next upload of each month's workbook; 0 until then.
ALTER TABLE "quality_facts" ADD COLUMN IF NOT EXISTS "score_sum" numeric DEFAULT 0 NOT NULL;

-- One figure per employee per month from the "Monthly" sheet: IRE (a
-- count), PKT and LH Utilization (percentages).
CREATE TABLE IF NOT EXISTS "monthly_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" date NOT NULL,
	"metric" text NOT NULL,
	"value" numeric NOT NULL,
	"source_import_id" uuid NOT NULL
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'monthly_metrics_employee_id_employees_id_fk') then
    ALTER TABLE "monthly_metrics" ADD CONSTRAINT "monthly_metrics_employee_id_employees_id_fk"
      FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monthly_metrics_source_import_id_import_batches_id_fk') then
    ALTER TABLE "monthly_metrics" ADD CONSTRAINT "monthly_metrics_source_import_id_import_batches_id_fk"
      FOREIGN KEY ("source_import_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;
  end if;
end $$;

CREATE UNIQUE INDEX IF NOT EXISTS "monthly_metrics_employee_month_metric_idx"
  ON "monthly_metrics" USING btree ("employee_id","month","metric");

-- Fail-closed like every other table: RLS on, reachable only through the
-- app role's own policy (scripts/sql/app-role.sql).
ALTER TABLE "monthly_metrics" ENABLE ROW LEVEL SECURITY;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'monthly_metrics' and policyname = 'emr_app_full_access'
  ) then
    create policy emr_app_full_access on public.monthly_metrics for all to emr_app using (true) with check (true);
  end if;
end $$;

-- Standard (non-critical) compliance errors from the Feedback sheet's
-- Standard column. Daily facts only: the scorecard sums them over its own
-- six-month window, no weekly row is ever written, and it opens no action
-- items of its own.
insert into public.kpi_definitions
  (code, name, type, direction, target, warning_threshold, failure_threshold, generates_action_items, aggregation)
values
  ('STANDARD_ERRORS', 'Standard Errors', 'number', 'lower_is_better', 0, 0, 0, false, 'sum')
on conflict (code) do nothing;

insert into drizzle.__drizzle_migrations (hash, created_at)
select '389730fabc5e9457436612a68f430b9134f44c8cce9bfcec95393ec61625e5cf', 1789354413193 -- 0050_scorecard_inputs
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '389730fabc5e9457436612a68f430b9134f44c8cce9bfcec95393ec61625e5cf');

commit;

-- Verify: 1 row each.
select
  (select count(*) from information_schema.columns where table_name = 'quality_facts' and column_name = 'score_sum') as column_present,
  (select count(*) from information_schema.tables where table_name = 'monthly_metrics') as table_present,
  (select count(*) from pg_policies where tablename = 'monthly_metrics' and policyname = 'emr_app_full_access') as policy_present,
  (select count(*) from public.kpi_definitions where code = 'STANDARD_ERRORS') as kpi_present,
  (select count(*) from drizzle.__drizzle_migrations where hash = '389730fabc5e9457436612a68f430b9134f44c8cce9bfcec95393ec61625e5cf') as tracked;

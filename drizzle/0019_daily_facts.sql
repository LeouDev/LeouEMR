CREATE TYPE "public"."kpi_aggregation" AS ENUM('ratio', 'ratio_pct', 'inverse_seconds', 'sum', 'derived');--> statement-breakpoint
CREATE TABLE "metric_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kpi_id" uuid NOT NULL,
	"fact_date" date NOT NULL,
	"numerator" numeric NOT NULL,
	"denominator" numeric NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"source_import_id" uuid
);
--> statement-breakpoint
CREATE TABLE "quality_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill_label" text NOT NULL,
	"fact_date" date NOT NULL,
	"audits" integer DEFAULT 0 NOT NULL,
	"imperfect" integer DEFAULT 0 NOT NULL,
	"markdowns" integer DEFAULT 0 NOT NULL,
	"source_import_id" uuid
);
--> statement-breakpoint
CREATE TABLE "skill_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill_label" text NOT NULL,
	"fact_date" date NOT NULL,
	"cases" numeric DEFAULT 0 NOT NULL,
	"hours" numeric DEFAULT 0 NOT NULL,
	"weight_hours" numeric DEFAULT 0 NOT NULL,
	"prod_weight" numeric DEFAULT 0 NOT NULL,
	"source_import_id" uuid
);
--> statement-breakpoint
ALTER TABLE "kpi_definitions" ADD COLUMN "aggregation" "kpi_aggregation" DEFAULT 'ratio' NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_facts" ADD CONSTRAINT "metric_facts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_facts" ADD CONSTRAINT "metric_facts_kpi_id_kpi_definitions_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpi_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_facts" ADD CONSTRAINT "metric_facts_source_import_id_import_batches_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_facts" ADD CONSTRAINT "quality_facts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_facts" ADD CONSTRAINT "quality_facts_source_import_id_import_batches_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_facts" ADD CONSTRAINT "skill_facts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_facts" ADD CONSTRAINT "skill_facts_source_import_id_import_batches_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_facts_employee_kpi_date_idx" ON "metric_facts" USING btree ("employee_id","kpi_id","fact_date");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_facts_employee_skill_date_idx" ON "quality_facts" USING btree ("employee_id","skill_label","fact_date");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_facts_employee_skill_date_idx" ON "skill_facts" USING btree ("employee_id","skill_label","fact_date");
CREATE TABLE "nps_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"fact_date" date NOT NULL,
	"promoters" integer DEFAULT 0 NOT NULL,
	"passives" integer DEFAULT 0 NOT NULL,
	"detractors" integer DEFAULT 0 NOT NULL,
	"source_import_id" uuid
);
--> statement-breakpoint
ALTER TABLE "nps_facts" ADD CONSTRAINT "nps_facts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_facts" ADD CONSTRAINT "nps_facts_source_import_id_import_batches_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nps_facts_employee_date_idx" ON "nps_facts" USING btree ("employee_id","fact_date");
--> statement-breakpoint
-- Match the fail-closed baseline of the sibling fact tables: RLS enabled with
-- no permissive policies, so nothing is readable except through the server's
-- own owner-role connection.
ALTER TABLE "nps_facts" ENABLE ROW LEVEL SECURITY;

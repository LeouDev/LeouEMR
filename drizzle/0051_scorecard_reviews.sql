CREATE TABLE "scorecard_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" date NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_score" numeric,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scorecard_reviews" ADD CONSTRAINT "scorecard_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_reviews" ADD CONSTRAINT "scorecard_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecard_reviews" ADD CONSTRAINT "scorecard_reviews_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scorecard_reviews_employee_month_idx" ON "scorecard_reviews" USING btree ("employee_id","month");--> statement-breakpoint
-- Fail-closed like every other public table: RLS on, reachable only through
-- the app role's policy (scripts/sql/app-role.sql).
ALTER TABLE "scorecard_reviews" ENABLE ROW LEVEL SECURITY;

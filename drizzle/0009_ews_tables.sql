CREATE TYPE "public"."ews_attrition" AS ENUM('none', 'black', 'absconding', 'loa', 'maternity');--> statement-breakpoint
CREATE TYPE "public"."ews_risk" AS ENUM('GREEN', 'YELLOW', 'RED', 'BLACK');--> statement-breakpoint
CREATE TABLE "ews_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"week" date NOT NULL,
	"indicators" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cap_active" boolean DEFAULT false NOT NULL,
	"attrition" "ews_attrition" DEFAULT 'none' NOT NULL,
	"attrition_date" date,
	"notes" text,
	"score" integer DEFAULT 0 NOT NULL,
	"risk_level" "ews_risk" DEFAULT 'GREEN' NOT NULL,
	"assessed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ews_indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ews_indicators_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "ews_assessments" ADD CONSTRAINT "ews_assessments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ews_assessments" ADD CONSTRAINT "ews_assessments_assessed_by_users_id_fk" FOREIGN KEY ("assessed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ews_assessments_employee_week_idx" ON "ews_assessments" USING btree ("employee_id","week");
CREATE TABLE "ews_headcount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supervisor_eid" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"opening_override" integer,
	"new_hires" integer DEFAULT 0 NOT NULL,
	"transfer_in" integer DEFAULT 0 NOT NULL,
	"transfer_out" integer DEFAULT 0 NOT NULL,
	"voluntary_attrition" integer DEFAULT 0 NOT NULL,
	"involuntary_attrition" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ews_assessments" ADD COLUMN "expected_return" date;--> statement-breakpoint
ALTER TABLE "ews_assessments" ADD COLUMN "action_plan" text;--> statement-breakpoint
ALTER TABLE "ews_headcount" ADD CONSTRAINT "ews_headcount_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ews_headcount_team_month_idx" ON "ews_headcount" USING btree ("supervisor_eid","year","month");
CREATE TABLE "survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"q1_overall" integer NOT NULL,
	"q2_ease" integer NOT NULL,
	"q3_findability" integer NOT NULL,
	"q4_nps" integer NOT NULL,
	"q5_feedback" text NOT NULL,
	CONSTRAINT "survey_responses_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
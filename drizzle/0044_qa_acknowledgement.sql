ALTER TABLE "qa_audits" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qa_audits" ADD COLUMN "acknowledged_by" uuid;--> statement-breakpoint
ALTER TABLE "qa_audits" ADD CONSTRAINT "qa_audits_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
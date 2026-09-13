-- One paste, one transaction: apply migration 0044 (audit acknowledgement)
-- and record it in drizzle's tracker, the way this project applies
-- migrations to production (the Supabase SQL editor as postgres).
-- Safe to run twice. Nothing to re-grant: the columns join a table the
-- limited role already has.

begin;

ALTER TABLE "qa_audits" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qa_audits" ADD COLUMN "acknowledged_by" uuid;--> statement-breakpoint
ALTER TABLE "qa_audits" ADD CONSTRAINT "qa_audits_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at) values
  ('c5f99ff6f10b831a8a802226e7630aebf38a8cd4296a361d0cc2e94c2f09d22e', 1789271366135) -- 0044_qa_acknowledgement
on conflict do nothing;

commit;

-- Verify: expect acknowledged_at and acknowledged_by.
select column_name from information_schema.columns
where table_name = 'qa_audits' and column_name like 'acknowledged%';

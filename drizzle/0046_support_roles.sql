ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'trainer';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'sme';--> statement-breakpoint
ALTER TABLE "qa_audits" ADD COLUMN IF NOT EXISTS "counts_for_requirement" boolean DEFAULT true NOT NULL;
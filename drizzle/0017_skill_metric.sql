CREATE TYPE "public"."skill_metric" AS ENUM('cph', 'aht', 'case_rate');--> statement-breakpoint
ALTER TABLE "skill_references" ADD COLUMN "metric" "skill_metric" DEFAULT 'cph' NOT NULL;
-- Dated notes against a root cause. One RCA still describes the underlying
-- problem; these record how the circumstances changed during a long episode,
-- which the single RCA otherwise cannot express.
CREATE TABLE "rca_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action_item_id" uuid NOT NULL REFERENCES "action_items"("id"),
  "week" date NOT NULL,
  "note" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rca_notes_item_week_idx" ON "rca_notes" ("action_item_id", "week");
--> statement-breakpoint
ALTER TABLE "rca_notes" ENABLE ROW LEVEL SECURITY;

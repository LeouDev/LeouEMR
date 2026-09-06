-- Time & Motion studies: a supervisor's timed observation of one call,
-- segment by segment against a baseline, ported from the standalone
-- LeouDev/Time-Motion tool. Recorded against an action item so it sits
-- alongside the RCA and action plan as evidence, rather than living
-- unattached the way the standalone tool leaves it (email or copy to
-- clipboard, nothing saved).
--
-- Segments are stored as a JSONB snapshot rather than joined to a live
-- config table: the reference tool lets a supervisor edit each baseline
-- before starting the call, so the baseline is an input to one study, not an
-- organizational setting to look up later. Freezing what was actually
-- measured — label, baseline, actual, computed status — means a later
-- change to the default segments can never retroactively alter a past
-- study's numbers, the same reason weekly_metric_results freezes its target.
CREATE TABLE "time_motion_studies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action_item_id" uuid NOT NULL REFERENCES "action_items"("id"),
  "call_reference" text,
  "segments" jsonb NOT NULL,
  "total_actual_seconds" integer NOT NULL,
  "total_baseline_seconds" integer NOT NULL,
  "remarks" text,
  "performed_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "time_motion_studies_action_item_idx" ON "time_motion_studies" ("action_item_id");
--> statement-breakpoint
-- Same fail-closed baseline as every other table: RLS on, no policies, so the
-- data is reachable only through the server's own connection.
ALTER TABLE "time_motion_studies" ENABLE ROW LEVEL SECURITY;

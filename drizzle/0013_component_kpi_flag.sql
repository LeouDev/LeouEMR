ALTER TABLE "kpi_definitions" ADD COLUMN "generates_action_items" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- The PAR rating, DPU and DPO are gates on the composite MBO result, so
-- they stay visible on the scorecard but do not open action items of
-- their own; MBO does.
UPDATE public.kpi_definitions SET generates_action_items = false
 WHERE code in ('PRODUCTION_RATE', 'DPU', 'DPO');

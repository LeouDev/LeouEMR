-- Custom SQL migration file, put your code below! --

-- The onboarding path is two nesting weeks, then ramp Week 1 through Week 8:
-- ten stages, 0-9, where 0038 had one nesting week and stages 0-8. Ramp
-- Week N moves from stage N to stage N+1, and the second nesting week gets
-- the first's target. Nothing about an assignment changes: its start week
-- is still the first nesting week. Guarded so a second run is a no-op.
ALTER TABLE "skill_ramp_schedules" DROP CONSTRAINT IF EXISTS "skill_ramp_schedules_stage_range";--> statement-breakpoint
DO $$
BEGIN
  -- Not yet shifted: no skill has a stage 9 row.
  IF NOT EXISTS (SELECT 1 FROM "skill_ramp_schedules" WHERE "stage" = 9) THEN
    -- Two steps, so the unique (skill, stage) index is never violated mid-way.
    UPDATE "skill_ramp_schedules" SET "stage" = "stage" + 100 WHERE "stage" BETWEEN 1 AND 8;
    UPDATE "skill_ramp_schedules" SET "stage" = "stage" - 99 WHERE "stage" >= 100;
  END IF;
END $$;--> statement-breakpoint
INSERT INTO "skill_ramp_schedules" ("skill_reference_id", "stage", "target")
SELECT "skill_reference_id", 1, "target" FROM "skill_ramp_schedules" WHERE "stage" = 0
ON CONFLICT ("skill_reference_id", "stage") DO NOTHING;--> statement-breakpoint
ALTER TABLE "skill_ramp_schedules" ADD CONSTRAINT "skill_ramp_schedules_stage_range" CHECK ("stage" BETWEEN 0 AND 9);

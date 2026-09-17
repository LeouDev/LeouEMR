-- One paste, one transaction: apply migration 0054 (the ramp has two
-- nesting weeks, then Week 1 through Week 8 — ten stages) and record it in
-- drizzle's tracker, the way this project applies migrations to production
-- (the Supabase SQL editor as postgres). Safe to run twice: the shift only
-- happens while no stage 9 exists, the second nesting week is inserted only
-- where missing, and the tracker insert is guarded.
-- Run after APPLY_0053_MY_SPACE.sql.
--
-- What it does to the schedule of every skill that has one: ramp Week N
-- moves from stage N to stage N+1 (Week 8 ends on stage 9), and stage 1
-- becomes the second nesting week with the same target as the first.
-- Assignments are untouched: an agent's ramp start week is still the first
-- nesting week. Afterwards, on the Ramp page, use "Re-apply all ramps" so
-- every ramping agent's already-imported weeks follow the new stages.

begin;

ALTER TABLE "skill_ramp_schedules" DROP CONSTRAINT IF EXISTS "skill_ramp_schedules_stage_range";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "skill_ramp_schedules" WHERE "stage" = 9) THEN
    UPDATE "skill_ramp_schedules" SET "stage" = "stage" + 100 WHERE "stage" BETWEEN 1 AND 8;
    UPDATE "skill_ramp_schedules" SET "stage" = "stage" - 99 WHERE "stage" >= 100;
  END IF;
END $$;

INSERT INTO "skill_ramp_schedules" ("skill_reference_id", "stage", "target")
SELECT "skill_reference_id", 1, "target" FROM "skill_ramp_schedules" WHERE "stage" = 0
ON CONFLICT ("skill_reference_id", "stage") DO NOTHING;

ALTER TABLE "skill_ramp_schedules" ADD CONSTRAINT "skill_ramp_schedules_stage_range" CHECK ("stage" BETWEEN 0 AND 9);

insert into drizzle.__drizzle_migrations (hash, created_at)
select '8b821a78678b4911af78705de2c06dc191671f3ad80a2642b077294afccbe156', 1789608162883 -- 0054_two_nesting_weeks
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '8b821a78678b4911af78705de2c06dc191671f3ad80a2642b077294afccbe156');

commit;

-- Verify: skills_with_schedule = stage9_rows = stage1_rows (3 today), no
-- stage above 9, constraint 1, tracked 1.
select
  (select count(distinct skill_reference_id) from skill_ramp_schedules) as skills_with_schedule,
  (select count(*) from skill_ramp_schedules where stage = 9) as stage9_rows,
  (select count(*) from skill_ramp_schedules where stage = 1) as stage1_rows,
  (select count(*) from skill_ramp_schedules where stage > 9) as above_9,
  (select count(*) from pg_constraint where conname = 'skill_ramp_schedules_stage_range') as constraint_present,
  (select count(*) from drizzle.__drizzle_migrations where hash = '8b821a78678b4911af78705de2c06dc191671f3ad80a2642b077294afccbe156') as tracked;

-- The PartD_Phones ladder as it now reads (nesting 1, nesting 2, week 1 … week 8):
select s.stage, s.target
from skill_ramp_schedules s join skill_references r on r.id = s.skill_reference_id
where r.code = 'partd_phones' order by s.stage;

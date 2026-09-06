-- New-hire ramp: a configured target per skill per stage of onboarding
-- (Nesting, then Week 1 through Week 8), and which employee is currently at
-- which stage on which skill.
--
-- The stage schedule is organization policy, shared across every new hire
-- on that skill — configured once here, the same way skill_references
-- itself holds one steady-state target rather than one per employee. What
-- is genuinely per employee is only the start date: the same schedule,
-- anchored to a different week for each new hire.
CREATE TABLE "skill_ramp_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "skill_reference_id" uuid NOT NULL REFERENCES "skill_references"("id"),
  -- 0 = Nesting, 1-8 = Week 1 through Week 8. Stage 9+ does not exist: once
  -- an assignment runs past week 8 it has completed ramp, and the skill's
  -- own steady-state target (skill_references.target) applies, exactly as
  -- it always has for an employee with no ramp assignment at all.
  "stage" integer NOT NULL,
  "target" numeric NOT NULL,
  CONSTRAINT "skill_ramp_schedules_stage_range" CHECK ("stage" BETWEEN 0 AND 8)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "skill_ramp_schedules_skill_stage_idx"
  ON "skill_ramp_schedules" ("skill_reference_id", "stage");
--> statement-breakpoint
ALTER TABLE "skill_ramp_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One row per employee currently ramping on a skill. Setting a new start
-- date for the same employee and skill replaces the row (upsert) rather than
-- accumulating history — a supervisor correcting a mistaken date is the
-- normal case, not an audited event.
CREATE TABLE "employee_ramp_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "skill_reference_id" uuid NOT NULL REFERENCES "skill_references"("id"),
  -- The Saturday that begins stage 0 (Nesting), matching the source data's
  -- own Saturday-Friday week convention.
  "ramp_start_week" date NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "employee_ramp_assignments_employee_skill_idx"
  ON "employee_ramp_assignments" ("employee_id", "skill_reference_id");
--> statement-breakpoint
ALTER TABLE "employee_ramp_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Seed the three ramp schedules supplied directly by the business, matched
-- to existing skills by code. Every row's Week 8 value equals that skill's
-- own steady-state target in skill_references — ramp converges to the
-- existing target rather than defining a second, possibly-drifting one.
INSERT INTO "skill_ramp_schedules" ("skill_reference_id", "stage", "target")
SELECT "skill_references"."id", "ramp"."stage", "ramp"."target" FROM "skill_references",
  (VALUES (0, 997), (1, 920), (2, 843), (3, 766), (4, 714), (5, 663), (6, 611), (7, 560), (8, 515))
    AS ramp(stage, target)
WHERE "skill_references"."code" = 'gen_phones';
--> statement-breakpoint
INSERT INTO "skill_ramp_schedules" ("skill_reference_id", "stage", "target")
SELECT "skill_references"."id", "ramp"."stage", "ramp"."target" FROM "skill_references",
  (VALUES (0, 997), (1, 920), (2, 843), (3, 766), (4, 714), (5, 663), (6, 611), (7, 560), (8, 500))
    AS ramp(stage, target)
WHERE "skill_references"."code" = 'partd_phones';
--> statement-breakpoint
INSERT INTO "skill_ramp_schedules" ("skill_reference_id", "stage", "target")
SELECT "skill_references"."id", "ramp"."stage", "ramp"."target" FROM "skill_references",
  (VALUES (0, 5.5), (1, 6.4), (2, 6.9), (3, 7.5), (4, 8.1), (5, 9.3), (6, 9.8), (7, 10.4), (8, 11))
    AS ramp(stage, target)
WHERE "skill_references"."code" = 'fax';

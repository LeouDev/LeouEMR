ALTER TABLE "kpi_definitions" ADD COLUMN "skill_reference_id" uuid;--> statement-breakpoint
ALTER TABLE "kpi_definitions" ADD CONSTRAINT "kpi_definitions_skill_reference_id_skill_references_id_fk" FOREIGN KEY ("skill_reference_id") REFERENCES "public"."skill_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_definitions" ADD CONSTRAINT "kpi_definitions_skill_reference_id_unique" UNIQUE("skill_reference_id");--> statement-breakpoint
-- One KPI definition per skill, so a skill's weekly result is evaluated,
-- tracked and opened as a development item through the same ledger and
-- engine as every other KPI. Named SKILL_<skill code>; the skill's own name
-- is what the development plan shows. The target is per employee-week (the
-- skill's target, or the ramp stage's while ramping) and travels on each
-- row, so the definition carries none. Kept in step for skills added or
-- renamed later by ensureSkillKpis() in src/lib/import-pipeline/commit.ts.
insert into public.kpi_definitions
  (code, name, type, direction, target, generates_action_items, aggregation, skill_reference_id)
select 'SKILL_' || upper(s.code), s.name, 'number'::kpi_type,
       (case when s.lower_is_better then 'lower_is_better' else 'higher_is_better' end)::kpi_direction,
       null, true, 'derived'::kpi_aggregation, s.id
from public.skill_references s
on conflict (code) do nothing;
--> statement-breakpoint
-- The per-skill items replace the KPI-level output items: an agent's handle
-- time, cases per hour and case rate are now followed skill by skill, so
-- these three stop opening items and their existing ones drop off every
-- list, the same way MBO's did in 0041. Their weekly rows stay.
update public.kpi_definitions set generates_action_items = false
 where code in ('AHT', 'CPH', 'CASE_RATE');

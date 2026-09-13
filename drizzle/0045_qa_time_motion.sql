ALTER TABLE "qa_audits" ADD COLUMN IF NOT EXISTS "time_motion" jsonb;
--> statement-breakpoint
-- The Phone form logs Time & Motion: five call segments with default
-- baselines the evaluator may override per audit (src/lib/quality/forms.ts).
update public.qa_forms
   set definition = definition || '{"timeMotion":{"segments":[{"label":"Greeting / verification","baseline":30},{"label":"Account lookup","baseline":60},{"label":"Issue discussion","baseline":240},{"label":"Resolution / hold","baseline":90},{"label":"Wrap-up","baseline":60}]}}'::jsonb,
       updated_at = now()
 where key = 'phone' and not (definition ? 'timeMotion');

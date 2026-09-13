-- One paste, one transaction: apply migration 0043 (Quality Audit) and
-- record it in drizzle's tracker, the way this project applies migrations
-- to production (the SQL editor as postgres; `drizzle-kit migrate` does
-- not reach the database from the Mac mini).
--
-- Safe to run twice: every CREATE is guarded by the transaction failing
-- as a whole if the type already exists, the seed is `on conflict do
-- nothing`, and the tracker insert is guarded too. Afterwards
-- `npm run db:migrate` reports nothing to apply. Then re-run
-- scripts/sql/app-role.sql so the limited role gets its policies.
--
-- The hash is the sha256 of drizzle/0043_quality_audit.sql, the key drizzle
-- uses; the timestamp is the journal's own `when` for that entry.

begin;

CREATE TYPE "public"."qa_result" AS ENUM('pass', 'fail');--> statement-breakpoint
CREATE TABLE "qa_audit_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"category" text NOT NULL,
	"attribute" text NOT NULL,
	"is_compliance" boolean DEFAULT false NOT NULL,
	"result" "qa_result" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"form_key" text NOT NULL,
	"evaluator_id" uuid NOT NULL,
	"audit_date" date NOT NULL,
	"header_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"remarks" text,
	"earned_points" integer NOT NULL,
	"max_points" integer NOT NULL,
	"score_pct" numeric(5, 2) NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_forms" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"header_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"definition" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qa_audit_results" ADD CONSTRAINT "qa_audit_results_audit_id_qa_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."qa_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_audits" ADD CONSTRAINT "qa_audits_agent_id_employees_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_audits" ADD CONSTRAINT "qa_audits_form_key_qa_forms_key_fk" FOREIGN KEY ("form_key") REFERENCES "public"."qa_forms"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_audits" ADD CONSTRAINT "qa_audits_evaluator_id_users_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qa_audit_results_audit_idx" ON "qa_audit_results" USING btree ("audit_id","position");--> statement-breakpoint
CREATE INDEX "qa_audit_results_result_idx" ON "qa_audit_results" USING btree ("result","category");--> statement-breakpoint
CREATE INDEX "qa_audits_agent_date_idx" ON "qa_audits" USING btree ("agent_id","audit_date");--> statement-breakpoint
CREATE INDEX "qa_audits_date_idx" ON "qa_audits" USING btree ("audit_date");--> statement-breakpoint
CREATE INDEX "qa_audits_evaluator_idx" ON "qa_audits" USING btree ("evaluator_id");--> statement-breakpoint
-- The four audit forms from the QA workbook (Phone, AV QA, MPA QA, Fax QA)
-- as typed in src/lib/quality/forms.ts. The app reads these rows; the code
-- constant is the seed and the tests' fixture. Re-running is harmless: an
-- existing key is left as it is, so a form edited in place is not undone.
insert into public.qa_forms (key, label, header_fields, definition, sort_order) values
  ('phone', 'Phone Form', '[{"key":"caseNo","label":"INQ / Case #","kind":"text","placeholder":"e.g. INQ-88213"},{"key":"callReason","label":"Call Reason","kind":"select","options":["Status Check-Approved","Status Check-Approved- Edit required","Call - Related to PA","Call Transferred","Call Dropped-Call Incomplete","Call Dropped-No Information","ePA Generated","Status Check-Denied","Status Check-Cancelled","Status Check-Pending","Status Check-Pending-Additional Info submitted","Priority Change","Call - Not Related to Prior Auth","New PA Initiation","Additional info for Pending MD Response","Request to cancel existing pending MD response case","Pre-Determination","Status Check - Formulary Coverage"]},{"key":"callerType","label":"Caller Type","kind":"select","options":["Provider","Member","Pharmacy","Third Party","Internal/Client"]}]'::jsonb, '{"type":"A","sections":[{"name":"Greeting","weight":1,"items":["Did not provide name/department","Did not verify whom they''re speaking to"]},{"name":"Obtaining & Documenting Information","weight":2,"items":["Did not obtain caller''s name","Did not obtain caller''s location (non-member)","Did not obtain callback number","Did not select correct caller type"]},{"name":"Member Authentication","weight":7,"items":["Did not ask third identifier when ID unavailable","Did not obtain first/last name","Did not obtain DOB","PHI given to unauthenticated caller"]},{"name":"MDO Authentication","weight":7,"items":["Did not obtain provider last name / NPI","Did not authenticate partial address","Did not authenticate office phone/fax"]},{"name":"Pharmacy Authentication","weight":7,"items":["Did not obtain pharmacy name / NPI/NABP","Did not ask if dispensing pharmacy"]},{"name":"Authentication Requirement (Client/Internal)","weight":6,"items":["Did not follow member auth protocol","Did not switch caller type/auth process as needed"]},{"name":"Transition Question","weight":1,"items":["Did not ask transition question","Did not confirm caller''s stated needs"]},{"name":"First Call Resolution","weight":6,"items":["Did not select correct account","Did not leverage claims lookup","Did not provide correct case status"]},{"name":"Documentation","weight":6,"items":["Did not select appropriate dropdown options","Did not revise guided verbiage with pertinent details","False documentation"]},{"name":"Drug Selection & Case Details","weight":6,"items":["Did not validate drug/formulation/qty/days supply","Did not correct brand/generic error"]},{"name":"Decision Accuracy at Action Screen","weight":6,"items":["Did not evaluate duplicates for merge","Did not follow WalkMe instructions"]},{"name":"Cancellation","weight":6,"items":["Did not use retry trial claim before cancel","Did not select correct cancel reason code"]},{"name":"Clinical Guideline","weight":6,"items":["Did not ask all external questions verbatim","Did not ask diagnosis question(s)"]},{"name":"Closing","weight":4,"items":["Did not ensure caller satisfaction","Did not offer/mention survey","Did not brand call/thank caller"]},{"name":"Call Holding","weight":1,"items":["Did not request permission before hold","Did not thank caller upon return"]},{"name":"Call Silence","weight":1,"items":["Exceeded 5s before greeting","Exceeded 20s unannounced silence"]},{"name":"Call Transfers","weight":5,"items":["Did not explain reason/need to transfer","Did not warm/cold transfer per policy"]},{"name":"Communication","weight":2,"items":["Mumbling/jargon/slang used","Used terms of endearment"]},{"name":"Acknowledge & Clarify","weight":2,"items":["Did not confirm active listening/understanding"]},{"name":"Repeat Caller - FCR","weight":10,"items":["Did not resolve all caller needs","Did not verify case(s) reviewed properly"]},{"name":"Use Caller''s Name","weight":1,"items":["Did not use caller''s name during call"]},{"name":"Positive Tone","weight":1,"items":["Tone not pleasant/helpful"]},{"name":"Professional Interaction","weight":1,"items":["Did not use courtesy words/phrases"]},{"name":"Interruptions","weight":2,"items":["Interrupted caller without apology"]},{"name":"Credibility/Confidence","weight":2,"items":["Spoke negatively of company/partners"]},{"name":"Call Control","weight":1,"items":["Did not keep call on track"]}],"compliance":["Incorrect case priority","Invalid cancellation","Case worked for incorrect member","Unprofessional/profane language"]}'::jsonb, 1),
  ('avqa', 'AV QA Form', '[{"key":"paNumber","label":"PA Number","kind":"text","placeholder":"e.g. PA-77213"},{"key":"callReason","label":"Call Reason","kind":"select","options":["Status Check-Approved","Status Check-Approved- Edit required","Call - Related to PA","Call Transferred","Call Dropped-Call Incomplete","Call Dropped-No Information","ePA Generated","Status Check-Denied","Status Check-Cancelled","Status Check-Pending","Status Check-Pending-Additional Info submitted","Priority Change","Call - Not Related to Prior Auth","New PA Initiation","Additional info for Pending MD Response","Request to cancel existing pending MD response case","Pre-Determination","Status Check - Formulary Coverage"]}]'::jsonb, '{"type":"B","groups":[{"name":"Provider Information","items":[{"label":"Correct provider selected","points":5},{"label":"Phone/fax updated when appropriate","points":5},{"label":"Address updated when appropriate","points":5}]},{"name":"Member","items":[{"label":"Correct name, DOB, member ID","points":5},{"label":"Correct plan / alt account created","points":5},{"label":"Third identifier verified","points":5}]},{"name":"Drug","items":[{"label":"Correct drug, strength & formulation","points":5},{"label":"Correct qty/day supply/direction","points":5},{"label":"Correct diagnosis entered verbatim","points":5},{"label":"Correct TCE radio button","points":5},{"label":"Correct backdate & route of admin","points":1}]},{"name":"Case Handling","items":[{"label":"Initiated PA for other meds listed","points":5},{"label":"Bypassed dup/fwd to appeals/rework/merge correctly","points":5},{"label":"Cancelled case properly / sent to appeals within window","points":5},{"label":"Correct appeals team, verbiage & number","points":5},{"label":"Reworked using copy case function when necessary","points":5},{"label":"Correctly selected Multiple Review PA Type","points":5}]},{"name":"Clinical Guidelines","items":[{"label":"Appropriately answers guideline questions","points":5},{"label":"Tried and failed medications captured","points":5}]},{"name":"Documentation","items":[{"label":"Documented relevant case info / Alt Coverage RightFax ID","points":3},{"label":"Outbound to MDO/RPh line for criteria/qty discrepancies","points":3},{"label":"GLP-1 drugs criteria / Medicare exception verified","points":3}]}],"compliance":["Invalid cancellation","Fax priority error","Redirected to appeals incorrectly","Multiple review/criteria error","Wrong member selected"]}'::jsonb, 2),
  ('mpaqa', 'MPA QA Form', '[{"key":"paNumber","label":"PA Number","kind":"text","placeholder":"e.g. PA-90210"},{"key":"callReason","label":"Reason of Call","kind":"select","options":["Status Check-Approved","Status Check-Approved- Edit required","Call - Related to PA","Call Transferred","Call Dropped-Call Incomplete","Call Dropped-No Information","ePA Generated","Status Check-Denied","Status Check-Cancelled","Status Check-Pending","Status Check-Pending-Additional Info submitted","Priority Change","Call - Not Related to Prior Auth","New PA Initiation","Additional info for Pending MD Response","Request to cancel existing pending MD response case","Pre-Determination","Status Check - Formulary Coverage"]}]'::jsonb, '{"type":"A","sections":[{"name":"Provider Information","weight":12,"items":["NPI used for provider","Provider info verified/updated with MDO on MPA cases","DEA converted to NPI when provided"]},{"name":"Provider Information Documentation","weight":1,"items":["Did not log case to SP (misroutes, rework)"]},{"name":"Member","weight":12,"items":["Three identifiers verified on incomplete fax cases"]},{"name":"Member Documentation","weight":1,"items":["Did not document member verification"]},{"name":"Drug","weight":12,"items":["Drug/formulation verified against claims history for MPA cases","Diabetic supply preferred/non-preferred checked"]},{"name":"Drug Documentation","weight":1,"items":["Did not document drug verification"]},{"name":"Case Handling – Verification & Authentication","weight":5,"items":["Correct PA Type & SLA time checked","Rework documented when PA type/SLA error found"]},{"name":"Case Handling – Meaningful Outreach","weight":8,"items":["Attempts to speak to correct office/provider","Clinical info sought before offering fax","Voicemail contains all required info"]},{"name":"Phone Handling – Communication & Transfer & Hold","weight":11,"items":["Clear communication, no jargon/slang","Transfer reason/permission given","Hold protocol followed"]},{"name":"Case Handling – Case Submission","weight":14,"items":["Continue Case button used correctly","Correct outreach verbiage selected","Correct phone/fax entered for provider"]},{"name":"Cancellation / Rework / Exclusion","weight":9,"items":["Reworked only when necessary, correct reason code used","Misrouted case cancelled/reworked per process"]}],"compliance":["Cancelled MPA without calling member first","Submitted case for wrong PA type","Failed to look for valid NDC (not a true plan exclusion)"]}'::jsonb, 3),
  ('faxqa', 'Fax QA Form', '[{"key":"caseNo","label":"Case #","kind":"text","placeholder":"e.g. FX-40213"},{"key":"callReason","label":"Call Reason","kind":"select","options":["Status Check-Approved","Status Check-Approved- Edit required","Call - Related to PA","Call Transferred","Call Dropped-Call Incomplete","Call Dropped-No Information","ePA Generated","Status Check-Denied","Status Check-Cancelled","Status Check-Pending","Status Check-Pending-Additional Info submitted","Priority Change","Call - Not Related to Prior Auth","New PA Initiation","Additional info for Pending MD Response","Request to cancel existing pending MD response case","Pre-Determination","Status Check - Formulary Coverage"]}]'::jsonb, '{"type":"A","sections":[{"name":"Provider Information","weight":5,"items":["Incorrect provider selected","Incorrect NPI entered","Phone/fax/address not updated when appropriate"]},{"name":"Member Information","weight":5,"items":["Incorrect plan selected","Multimember hierarchy not followed","Third identifier not verified"]},{"name":"Drug Selection & Case Details","weight":4,"items":["Incorrect drug/formulation/strength","Incorrect days supply/quantity","Brand vs generic inaccuracy","Incorrect backdate"]},{"name":"Decision Accuracy at Action Screen","weight":5,"items":["Failed to verify FLU for incorrect NDC","Failed to use Retry Trial Claim","Case not cancelled/reworked properly"]},{"name":"Clinical Guidelines","weight":5,"items":["Incorrect guideline answer selected","Failed OBC to MDO","Tried and failed medications not captured"]},{"name":"Documentation","weight":5,"items":["Did not call correct phone number when multiple present","Did not document whom they spoke to","Did not document OBC outcome"]}],"compliance":["Wrong member selected","Fax priority error","Invalid cancellation"]}'::jsonb, 4)
on conflict (key) do nothing;
--> statement-breakpoint
-- The deployed app reads through the limited role; its default privileges
-- cover tables postgres creates later, and this makes the grant explicit
-- where the role exists. No-op where it does not (a local database).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'emr_app') then
    grant select, insert, update, delete on public.qa_forms, public.qa_audits, public.qa_audit_results to emr_app;
  end if;
end $$;

--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at) values
  ('dceb7eaf1c5eb55c8261d6bb9f4faf4f05dfd5f7b0e969ff877af98d35628e94', 1789269851948) -- 0043_quality_audit
on conflict do nothing;

commit;

-- Verify: expect the four forms and one more tracker row than before.
select key, label, sort_order from public.qa_forms order by sort_order;

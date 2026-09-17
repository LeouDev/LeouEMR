-- One paste, one transaction: apply migration 0057 (the AV, MPA and Fax QA
-- forms ask for Tech Decision in place of Call Reason) and record it in
-- drizzle's tracker, the way this project applies migrations to production
-- (the Supabase SQL editor as postgres). Safe to run twice: a form is updated
-- only while its header differs, the tracker insert is guarded. No schema
-- change, nothing to re-grant. The Phone form is untouched.
--
-- Nothing already filed moves. An audit filed before this keeps its
-- header_values -> 'callReason' exactly as recorded, and the app now shows
-- that as "Call Reason (retired)" rather than dropping it.

begin;

with wanted(key, header_fields) as (values
  ('avqa', '[
  {
    "key": "paNumber",
    "label": "PA Number",
    "kind": "text",
    "placeholder": "e.g. PA-77213"
  },
  {
    "key": "techDecision",
    "label": "Tech Decision",
    "kind": "select",
    "options": [
      "Pend",
      "Deny",
      "Approved",
      "Fax for Appls",
      "Merged",
      "RARA",
      "RAFA",
      "RAFC-C",
      "NEITAP",
      "NEITP",
      "DNF",
      "MNF"
    ]
  }
]'::jsonb),
  ('mpaqa', '[
  {
    "key": "paNumber",
    "label": "PA Number",
    "kind": "text",
    "placeholder": "e.g. PA-90210"
  },
  {
    "key": "techDecision",
    "label": "Tech Decision",
    "kind": "select",
    "options": [
      "Pend",
      "Deny",
      "Approved",
      "Fax for Appls",
      "Merged",
      "RARA",
      "RAFA",
      "RAFC-C",
      "NEITAP",
      "NEITP",
      "DNF",
      "MNF"
    ]
  }
]'::jsonb),
  ('faxqa', '[
  {
    "key": "caseNo",
    "label": "Case #",
    "kind": "text",
    "placeholder": "e.g. FX-40213"
  },
  {
    "key": "techDecision",
    "label": "Tech Decision",
    "kind": "select",
    "options": [
      "Pend",
      "Deny",
      "Approved",
      "Fax for Appls",
      "Merged",
      "RARA",
      "RAFA",
      "RAFC-C",
      "NEITAP",
      "NEITP",
      "DNF",
      "MNF"
    ]
  }
]'::jsonb)
)
update public.qa_forms as form
   set header_fields = wanted.header_fields,
       updated_at = now()
  from wanted
 where form.key = wanted.key
   and form.header_fields is distinct from wanted.header_fields;

--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at)
select '0d4c1e584f820fc04c2bafed78f2123fd64d1bfbfbf0d37f54d1cce1f1b8a672', 1789680408886 -- 0057_tech_decision_header
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '0d4c1e584f820fc04c2bafed78f2123fd64d1bfbfbf0d37f54d1cce1f1b8a672');

commit;

-- Verify: expect three rows, each reading techDecision / Tech Decision / 12,
-- and the Phone form still on callReason.
select key,
       header_fields -> 1 ->> 'key' as second_field,
       header_fields -> 1 ->> 'label' as label,
       jsonb_array_length(header_fields -> 1 -> 'options') as options
  from public.qa_forms
 where key in ('avqa', 'mpaqa', 'faxqa', 'phone')
 order by sort_order;

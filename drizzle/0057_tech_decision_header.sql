-- Custom SQL migration file, put your code below! --

-- The AV, MPA and Fax forms ask for the technician's decision in place of a
-- call reason. `qa_forms` is what the evaluator's form reads, so the seed in
-- src/lib/quality/forms.ts does not move the live forms on its own — this
-- does (0056 is the same lesson).
--
-- Those three audit case work rather than a conversation: "why did they ring"
-- is a Phone question, and on a fax or a written PA the useful header is the
-- decision the case ended on. The Phone form keeps Call Reason, untouched.
--
-- Nothing already filed moves. An audit filed before this keeps its
-- header_values -> 'callReason' exactly as recorded. That key is no longer a
-- field on the form, so headerRows (src/lib/quality/header-values.ts) shows
-- it as "Call Reason (retired)" in the history panel and the raw-data export
-- rather than dropping it.

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

-- One paste, one transaction: apply migration 0056 (the Fax QA form becomes
-- PANDA Fax — per-attribute scoring out of 100 in place of the
-- category-weighted 29-point form) and record it in drizzle's tracker, the
-- way this project applies migrations to production (the Supabase SQL
-- editor as postgres). Safe to run twice: the form is updated only while
-- its definition differs, the tracker insert is guarded. No schema change,
-- nothing to re-grant.
--
-- Nothing already filed moves: qa_audits stores the figures and
-- qa_audit_results stores the category and attribute as text, so audits
-- filed before this keep their own scores and their own wording.

begin;

with panda as (select '{
  "type": "B",
  "groups": [
    {
      "name": "Provider Information",
      "items": [
        {
          "label": "Agent selected Incorrect Provider",
          "points": 5,
          "subItems": [
            "Incorrect NPI was entered"
          ]
        },
        {
          "label": "Agent update Phone or Fax Number when appropriate",
          "points": 5
        },
        {
          "label": "Agent update Address when appropriate",
          "points": 5
        }
      ]
    },
    {
      "name": "Member Information",
      "items": [
        {
          "label": "Agent selected correct Plan",
          "points": 5,
          "subItems": [
            "Agent must select correct member account according to the multimember hierarchy",
            "Agent must enter cases under all applicable accounts even if not skilled"
          ]
        },
        {
          "label": "Agent verified Third Identifier",
          "points": 5
        }
      ]
    },
    {
      "name": "Drug Selection and Case Details",
      "items": [
        {
          "label": "Agent selected Correct Drug",
          "points": 4
        },
        {
          "label": "Agent selected Correct Formulation",
          "points": 4
        },
        {
          "label": "Agent selected Correct Strength",
          "points": 4
        },
        {
          "label": "Agent entered Correct Days supply and Quantity",
          "points": 4,
          "subItems": [
            "Quantity and days supply must be entered exactly according to the attachment"
          ]
        },
        {
          "label": "Brand vs Generic Accuracy",
          "points": 3
        },
        {
          "label": "Agent selected Correct TCE radio button",
          "points": 3,
          "subItems": [
            "Ensure the Pre-Benefit Determination flag is selected appropriately when applicable"
          ]
        },
        {
          "label": "Agent entered Correct Backdate",
          "points": 3
        }
      ]
    },
    {
      "name": "Decision Accuracy at the Action Screen",
      "items": [
        {
          "label": "Agent failed to verify FLU if incorrect NDC was used",
          "points": 5,
          "subItems": [
            "Agent must change the NDC if an invalid drug was previously selected"
          ]
        },
        {
          "label": "Agent failed to use Retry Trial Claim function",
          "points": 5,
          "subItems": [
            "Retry Trial claim was used for RAFA and RARA cancellation"
          ]
        },
        {
          "label": "Agent initiate PA and any new PA’s associated with other medication listed in the fax request",
          "points": 5
        },
        {
          "label": "Agent bypass dup screen/forward to appeals/reworks/merge correctly",
          "points": 5
        },
        {
          "label": "Agent cancelled the case properly",
          "points": 5,
          "subItems": [
            "Correct cancel reason code was used"
          ]
        },
        {
          "label": "Agent Reworked when necessary",
          "points": 5
        },
        {
          "label": "Agent correctly selected Multiple Review PA Type",
          "points": 5,
          "subItems": [
            "Agent must identify and add any missing PA Type reviews to the Multiple Reviews dropdown"
          ]
        }
      ]
    },
    {
      "name": "Clinical Guidelines",
      "items": [
        {
          "label": "Agent choose other/not known/not Provided when information is provided",
          "points": 5,
          "subItems": [
            "Agent adds information provided",
            "Agent entered IntialvsReauthorization",
            "Agent answered Plan Exclusion questions",
            "Agent answered Formulary Speci",
            "Agent answered Quantity limits question correctly",
            "Agent answered Diagnosis Question",
            "Agent failed to make OBC to MDO",
            "Agent failed to do corret calculation",
            "Agent failed to enter appropriate edits",
            "Agent allows the System driven decision",
            "Agent does not manipulate answers to force pend the case without specific direction"
          ]
        },
        {
          "label": "Tried and Failed medications",
          "points": 5
        }
      ]
    },
    {
      "name": "Documentation",
      "items": [
        {
          "label": "Agent called the Phone number when multiple numbers are present",
          "points": 5,
          "subItems": [
            "Agent failed to document additional PA Types",
            "Agent documented whom they spoke to",
            "Agent documented Outcome of OBC-document reason for the OBC and information obtained",
            "Agent did not Document when the way technician answered the CG does not align with Fax",
            "Agent failed to document correct regimen to QTY question",
            "Agent must copy/paste answers in the Additional notes for Incomplete cases"
          ]
        }
      ]
    }
  ],
  "compliance": [
    "Wrong Member Selected",
    "Fax Priority",
    "Invalid Cancellation"
  ]
}'::jsonb as definition)
update public.qa_forms as form
   set definition = panda.definition,
       updated_at = now()
  from panda
 where form.key = 'faxqa'
   and form.definition is distinct from panda.definition;

--> statement-breakpoint
insert into drizzle.__drizzle_migrations (hash, created_at)
select '442ceb80842eaefb2db55c8637e86d9a477c18a92aefbf589aca8262d063e7e5', 1789627361861 -- 0056_panda_fax_form
 where not exists (select 1 from drizzle.__drizzle_migrations where hash = '442ceb80842eaefb2db55c8637e86d9a477c18a92aefbf589aca8262d063e7e5');

commit;

-- Verify: expect B, 6 categories, 3 compliance items and 100 points.
select definition->>'type' as form_type,
       jsonb_array_length(definition->'groups') as categories,
       jsonb_array_length(definition->'compliance') as compliance_items,
       (select sum((item->>'points')::int)
          from jsonb_array_elements(definition->'groups') as category,
               jsonb_array_elements(category->'items') as item) as total_points
  from public.qa_forms
 where key = 'faxqa';

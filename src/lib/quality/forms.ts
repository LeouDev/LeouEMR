/**
 * The audit forms, as seeded into `qa_forms` — the four sheets of the QA
 * workbook, typed. The database row is what the app reads at runtime (so a
 * form can be adjusted without a deploy); this file is the seed the
 * migration wrote, and what the scoring tests run against.
 *
 * Two shapes. A category-weighted form (Phone, MPA QA, Fax QA) gives each
 * category a fixed point weight and lists the lettered ways it can fail —
 * one failed criterion forfeits the whole category. A flat-weighted form
 * (AV QA) prices every item on its own, grouped for reading only. Both end
 * in a compliance list: any failure there zeroes the audit.
 */

export interface QaSection {
  name: string;
  weight: number;
  items: string[];
}

export interface QaPricedItem {
  label: string;
  points: number;
}

export interface QaGroup {
  name: string;
  items: QaPricedItem[];
}

/**
 * Time & Motion segments, on the forms that log call timings alongside the
 * scoring (the Phone form). Baselines are defaults the evaluator may
 * override per audit; see src/lib/quality/time-motion.ts.
 */
export interface QaTimeMotionSpec {
  segments: Array<{ label: string; baseline: number }>;
}

export type QaDefinition =
  | { type: "A"; sections: QaSection[]; compliance: string[]; timeMotion?: QaTimeMotionSpec }
  | { type: "B"; groups: QaGroup[]; compliance: string[]; timeMotion?: QaTimeMotionSpec };

export interface QaHeaderField {
  key: string;
  label: string;
  kind: "text" | "select";
  options?: string[];
  placeholder?: string;
}

export interface QaForm {
  key: string;
  label: string;
  headerFields: QaHeaderField[];
  definition: QaDefinition;
  sortOrder: number;
}

export const CALL_REASON_OPTIONS = [
  "Status Check-Approved",
  "Status Check-Approved- Edit required",
  "Call - Related to PA",
  "Call Transferred",
  "Call Dropped-Call Incomplete",
  "Call Dropped-No Information",
  "ePA Generated",
  "Status Check-Denied",
  "Status Check-Cancelled",
  "Status Check-Pending",
  "Status Check-Pending-Additional Info submitted",
  "Priority Change",
  "Call - Not Related to Prior Auth",
  "New PA Initiation",
  "Additional info for Pending MD Response",
  "Request to cancel existing pending MD response case",
  "Pre-Determination",
  "Status Check - Formulary Coverage",
];

/** Applies to the Phone Form only. */
export const CALLER_TYPE_OPTIONS = ["Provider", "Member", "Pharmacy", "Third Party", "Internal/Client"];

const callReason = (label = "Call Reason"): QaHeaderField => ({
  key: "callReason",
  label,
  kind: "select",
  options: CALL_REASON_OPTIONS,
});

export const QA_FORM_SEED: QaForm[] = [
  {
    key: "phone",
    label: "Phone Form",
    sortOrder: 1,
    headerFields: [
      { key: "caseNo", label: "INQ / Case #", kind: "text", placeholder: "e.g. INQ-88213" },
      callReason(),
      { key: "callerType", label: "Caller Type", kind: "select", options: CALLER_TYPE_OPTIONS },
    ],
    definition: {
      type: "A",
      sections: [
        { name: "Greeting", weight: 1, items: ["Did not provide name/department", "Did not verify whom they're speaking to"] },
        {
          name: "Obtaining & Documenting Information",
          weight: 2,
          items: [
            "Did not obtain caller's name",
            "Did not obtain caller's location (non-member)",
            "Did not obtain callback number",
            "Did not select correct caller type",
          ],
        },
        {
          name: "Member Authentication",
          weight: 7,
          items: [
            "Did not ask third identifier when ID unavailable",
            "Did not obtain first/last name",
            "Did not obtain DOB",
            "PHI given to unauthenticated caller",
          ],
        },
        {
          name: "MDO Authentication",
          weight: 7,
          items: [
            "Did not obtain provider last name / NPI",
            "Did not authenticate partial address",
            "Did not authenticate office phone/fax",
          ],
        },
        {
          name: "Pharmacy Authentication",
          weight: 7,
          items: ["Did not obtain pharmacy name / NPI/NABP", "Did not ask if dispensing pharmacy"],
        },
        {
          name: "Authentication Requirement (Client/Internal)",
          weight: 6,
          items: ["Did not follow member auth protocol", "Did not switch caller type/auth process as needed"],
        },
        { name: "Transition Question", weight: 1, items: ["Did not ask transition question", "Did not confirm caller's stated needs"] },
        {
          name: "First Call Resolution",
          weight: 6,
          items: ["Did not select correct account", "Did not leverage claims lookup", "Did not provide correct case status"],
        },
        {
          name: "Documentation",
          weight: 6,
          items: [
            "Did not select appropriate dropdown options",
            "Did not revise guided verbiage with pertinent details",
            "False documentation",
          ],
        },
        {
          name: "Drug Selection & Case Details",
          weight: 6,
          items: ["Did not validate drug/formulation/qty/days supply", "Did not correct brand/generic error"],
        },
        {
          name: "Decision Accuracy at Action Screen",
          weight: 6,
          items: ["Did not evaluate duplicates for merge", "Did not follow WalkMe instructions"],
        },
        { name: "Cancellation", weight: 6, items: ["Did not use retry trial claim before cancel", "Did not select correct cancel reason code"] },
        { name: "Clinical Guideline", weight: 6, items: ["Did not ask all external questions verbatim", "Did not ask diagnosis question(s)"] },
        {
          name: "Closing",
          weight: 4,
          items: ["Did not ensure caller satisfaction", "Did not offer/mention survey", "Did not brand call/thank caller"],
        },
        { name: "Call Holding", weight: 1, items: ["Did not request permission before hold", "Did not thank caller upon return"] },
        { name: "Call Silence", weight: 1, items: ["Exceeded 5s before greeting", "Exceeded 20s unannounced silence"] },
        { name: "Call Transfers", weight: 5, items: ["Did not explain reason/need to transfer", "Did not warm/cold transfer per policy"] },
        { name: "Communication", weight: 2, items: ["Mumbling/jargon/slang used", "Used terms of endearment"] },
        { name: "Acknowledge & Clarify", weight: 2, items: ["Did not confirm active listening/understanding"] },
        { name: "Repeat Caller - FCR", weight: 10, items: ["Did not resolve all caller needs", "Did not verify case(s) reviewed properly"] },
        { name: "Use Caller's Name", weight: 1, items: ["Did not use caller's name during call"] },
        { name: "Positive Tone", weight: 1, items: ["Tone not pleasant/helpful"] },
        { name: "Professional Interaction", weight: 1, items: ["Did not use courtesy words/phrases"] },
        { name: "Interruptions", weight: 2, items: ["Interrupted caller without apology"] },
        { name: "Credibility/Confidence", weight: 2, items: ["Spoke negatively of company/partners"] },
        { name: "Call Control", weight: 1, items: ["Did not keep call on track"] },
      ],
      compliance: ["Incorrect case priority", "Invalid cancellation", "Case worked for incorrect member", "Unprofessional/profane language"],
      timeMotion: {
        segments: [
          { label: "Greeting / verification", baseline: 30 },
          { label: "Account lookup", baseline: 60 },
          { label: "Issue discussion", baseline: 240 },
          { label: "Resolution / hold", baseline: 90 },
          { label: "Wrap-up", baseline: 60 },
        ],
      },
    },
  },
  {
    key: "avqa",
    label: "AV QA Form",
    sortOrder: 2,
    headerFields: [{ key: "paNumber", label: "PA Number", kind: "text", placeholder: "e.g. PA-77213" }, callReason()],
    definition: {
      type: "B",
      groups: [
        {
          name: "Provider Information",
          items: [
            { label: "Correct provider selected", points: 5 },
            { label: "Phone/fax updated when appropriate", points: 5 },
            { label: "Address updated when appropriate", points: 5 },
          ],
        },
        {
          name: "Member",
          items: [
            { label: "Correct name, DOB, member ID", points: 5 },
            { label: "Correct plan / alt account created", points: 5 },
            { label: "Third identifier verified", points: 5 },
          ],
        },
        {
          name: "Drug",
          items: [
            { label: "Correct drug, strength & formulation", points: 5 },
            { label: "Correct qty/day supply/direction", points: 5 },
            { label: "Correct diagnosis entered verbatim", points: 5 },
            { label: "Correct TCE radio button", points: 5 },
            { label: "Correct backdate & route of admin", points: 1 },
          ],
        },
        {
          name: "Case Handling",
          items: [
            { label: "Initiated PA for other meds listed", points: 5 },
            { label: "Bypassed dup/fwd to appeals/rework/merge correctly", points: 5 },
            { label: "Cancelled case properly / sent to appeals within window", points: 5 },
            { label: "Correct appeals team, verbiage & number", points: 5 },
            { label: "Reworked using copy case function when necessary", points: 5 },
            { label: "Correctly selected Multiple Review PA Type", points: 5 },
          ],
        },
        {
          name: "Clinical Guidelines",
          items: [
            { label: "Appropriately answers guideline questions", points: 5 },
            { label: "Tried and failed medications captured", points: 5 },
          ],
        },
        {
          name: "Documentation",
          items: [
            { label: "Documented relevant case info / Alt Coverage RightFax ID", points: 3 },
            { label: "Outbound to MDO/RPh line for criteria/qty discrepancies", points: 3 },
            { label: "GLP-1 drugs criteria / Medicare exception verified", points: 3 },
          ],
        },
      ],
      compliance: [
        "Invalid cancellation",
        "Fax priority error",
        "Redirected to appeals incorrectly",
        "Multiple review/criteria error",
        "Wrong member selected",
      ],
    },
  },
  {
    key: "mpaqa",
    label: "MPA QA Form",
    sortOrder: 3,
    headerFields: [{ key: "paNumber", label: "PA Number", kind: "text", placeholder: "e.g. PA-90210" }, callReason("Reason of Call")],
    definition: {
      type: "A",
      sections: [
        {
          name: "Provider Information",
          weight: 12,
          items: ["NPI used for provider", "Provider info verified/updated with MDO on MPA cases", "DEA converted to NPI when provided"],
        },
        { name: "Provider Information Documentation", weight: 1, items: ["Did not log case to SP (misroutes, rework)"] },
        { name: "Member", weight: 12, items: ["Three identifiers verified on incomplete fax cases"] },
        { name: "Member Documentation", weight: 1, items: ["Did not document member verification"] },
        {
          name: "Drug",
          weight: 12,
          items: ["Drug/formulation verified against claims history for MPA cases", "Diabetic supply preferred/non-preferred checked"],
        },
        { name: "Drug Documentation", weight: 1, items: ["Did not document drug verification"] },
        {
          name: "Case Handling – Verification & Authentication",
          weight: 5,
          items: ["Correct PA Type & SLA time checked", "Rework documented when PA type/SLA error found"],
        },
        {
          name: "Case Handling – Meaningful Outreach",
          weight: 8,
          items: [
            "Attempts to speak to correct office/provider",
            "Clinical info sought before offering fax",
            "Voicemail contains all required info",
          ],
        },
        {
          name: "Phone Handling – Communication & Transfer & Hold",
          weight: 11,
          items: ["Clear communication, no jargon/slang", "Transfer reason/permission given", "Hold protocol followed"],
        },
        {
          name: "Case Handling – Case Submission",
          weight: 14,
          items: ["Continue Case button used correctly", "Correct outreach verbiage selected", "Correct phone/fax entered for provider"],
        },
        {
          name: "Cancellation / Rework / Exclusion",
          weight: 9,
          items: ["Reworked only when necessary, correct reason code used", "Misrouted case cancelled/reworked per process"],
        },
      ],
      compliance: [
        "Cancelled MPA without calling member first",
        "Submitted case for wrong PA type",
        "Failed to look for valid NDC (not a true plan exclusion)",
      ],
    },
  },
  {
    key: "faxqa",
    label: "Fax QA Form",
    sortOrder: 4,
    headerFields: [{ key: "caseNo", label: "Case #", kind: "text", placeholder: "e.g. FX-40213" }, callReason()],
    definition: {
      type: "A",
      sections: [
        {
          name: "Provider Information",
          weight: 5,
          items: ["Incorrect provider selected", "Incorrect NPI entered", "Phone/fax/address not updated when appropriate"],
        },
        {
          name: "Member Information",
          weight: 5,
          items: ["Incorrect plan selected", "Multimember hierarchy not followed", "Third identifier not verified"],
        },
        {
          name: "Drug Selection & Case Details",
          weight: 4,
          items: [
            "Incorrect drug/formulation/strength",
            "Incorrect days supply/quantity",
            "Brand vs generic inaccuracy",
            "Incorrect backdate",
          ],
        },
        {
          name: "Decision Accuracy at Action Screen",
          weight: 5,
          items: ["Failed to verify FLU for incorrect NDC", "Failed to use Retry Trial Claim", "Case not cancelled/reworked properly"],
        },
        {
          name: "Clinical Guidelines",
          weight: 5,
          items: ["Incorrect guideline answer selected", "Failed OBC to MDO", "Tried and failed medications not captured"],
        },
        {
          name: "Documentation",
          weight: 5,
          items: [
            "Did not call correct phone number when multiple present",
            "Did not document whom they spoke to",
            "Did not document OBC outcome",
          ],
        },
      ],
      compliance: ["Wrong member selected", "Fax priority error", "Invalid cancellation"],
    },
  },
];

/** A stored row's JSON columns, narrowed back to the types above. */
export function qaFormFromRow(row: {
  key: string;
  label: string;
  headerFields: unknown;
  definition: unknown;
  sortOrder: number;
}): QaForm {
  return {
    key: row.key,
    label: row.label,
    headerFields: (row.headerFields as QaHeaderField[]) ?? [],
    definition: row.definition as QaDefinition,
    sortOrder: row.sortOrder,
  };
}

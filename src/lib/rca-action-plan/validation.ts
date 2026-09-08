import { z } from "zod";

/**
 * Required fields for RCA and Action Plan.
 *
 * Spec section 8: an action item cannot be sent to the agent until both are
 * complete, so these schemas are the gate — the server action refuses the
 * submission rather than the UI merely hiding the button.
 */
// Matches the limit every other free-text field in the app carries (RCA
// follow-up notes, EWS notes, PTO reason/decision) — these four were the
// one schema in the codebase with no upper bound at all, so an authorized
// caller could otherwise store an unbounded string that re-renders on every
// future load of the action item.
const PROSE_MAX = 2000;

export const rcaSchema = z.object({
  actionItemId: z.string().uuid(),
  problemStatement: z.string().trim().min(10, "Describe the problem in at least 10 characters").max(PROSE_MAX),
  rootCauseCategoryId: z.string().uuid("Select a root cause category"),
  rootCauseDetails: z.string().trim().min(10, "Give at least 10 characters of detail").max(PROSE_MAX),
  contributingFactors: z.string().trim().max(PROSE_MAX).optional().or(z.literal("")),
  evidenceNotes: z.string().trim().max(PROSE_MAX).optional().or(z.literal("")),
});

export const actionPlanSchema = z.object({
  actionItemId: z.string().uuid(),
  correctiveAction: z.string().trim().min(10, "Describe the corrective action").max(PROSE_MAX),
  expectedBehavior: z.string().trim().min(10, "Describe the expected behavior").max(PROSE_MAX),
  targetMetric: z.string().trim().min(1, "Name the target metric").max(200),
  targetValue: z.number().finite("Enter a target value"),
  dueDate: z.string().min(1, "Set a due date"),
  followUpDate: z.string().min(1, "Set a follow-up date"),
  coachingRequired: z.boolean(),
  trainingRequired: z.boolean(),
  supervisorNotes: z.string().trim().max(PROSE_MAX).optional().or(z.literal("")),
});

export type RcaInput = z.infer<typeof rcaSchema>;
export type ActionPlanInput = z.infer<typeof actionPlanSchema>;

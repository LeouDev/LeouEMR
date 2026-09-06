import { z } from "zod";

/**
 * Required fields for RCA and Action Plan.
 *
 * Spec section 8: an action item cannot be sent to the agent until both are
 * complete, so these schemas are the gate — the server action refuses the
 * submission rather than the UI merely hiding the button.
 */
export const rcaSchema = z.object({
  actionItemId: z.string().uuid(),
  problemStatement: z.string().trim().min(10, "Describe the problem in at least 10 characters"),
  rootCauseCategoryId: z.string().uuid("Select a root cause category"),
  rootCauseDetails: z.string().trim().min(10, "Give at least 10 characters of detail"),
  contributingFactors: z.string().trim().optional().or(z.literal("")),
  evidenceNotes: z.string().trim().optional().or(z.literal("")),
});

export const actionPlanSchema = z.object({
  actionItemId: z.string().uuid(),
  correctiveAction: z.string().trim().min(10, "Describe the corrective action"),
  expectedBehavior: z.string().trim().min(10, "Describe the expected behavior"),
  targetMetric: z.string().trim().min(1, "Name the target metric"),
  targetValue: z.number().finite("Enter a target value"),
  dueDate: z.string().min(1, "Set a due date"),
  followUpDate: z.string().min(1, "Set a follow-up date"),
  coachingRequired: z.boolean(),
  trainingRequired: z.boolean(),
  supervisorNotes: z.string().trim().optional().or(z.literal("")),
});

export type RcaInput = z.infer<typeof rcaSchema>;
export type ActionPlanInput = z.infer<typeof actionPlanSchema>;

/** Refusals the Quality Audit action returns, shared with its tests. */
export const NOT_A_LEADER = "Only team leaders, managers and administrators can audit.";
export const NOT_AN_EVALUATOR = "Only team leaders file audits.";
export const OUT_OF_SCOPE = "That agent is not on your roster.";
export const AGENT_LEFT = "That agent had left before the week of that audit.";
export const AUDIT_DATE_NOT_TODAY = "An audit is dated the day it is filed — today.";
export const TRANSACTION_DATE_MISSING = "Enter the transaction date.";
export const TRANSACTION_DATE_AFTER_AUDIT = "The transaction date cannot be after the audit date.";

/** Refusals on My Quality Scores. */
export const NOT_AN_AGENT = "Only an agent acknowledges their own audits.";
export const NOT_LINKED = "Your account is not linked to an employee ID yet — ask an administrator.";
export const NOT_YOURS = "That audit is not yours, or it is already acknowledged.";

import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["admin", "manager", "supervisor", "agent"]);
export const userStatusEnum = pgEnum("user_status", ["active", "pending", "disabled"]);
export const employeeStatusEnum = pgEnum("employee_status", ["active", "on_leave", "separated"]);

export const kpiTypeEnum = pgEnum("kpi_type", ["percentage", "number", "score", "boolean"]);
export const kpiDirectionEnum = pgEnum("kpi_direction", [
  "higher_is_better",
  "lower_is_better",
  "range",
  "boolean_match",
]);
export const kpiStatusEnum = pgEnum("kpi_status", ["pass", "warning", "fail"]);
export const weeklyResultEnum = pgEnum("weekly_result", ["pass", "fail"]);

export const importStatusEnum = pgEnum("import_status", [
  "pending",
  "previewing",
  "validated",
  "committed",
  "failed",
]);

// Mirrors src/lib/action-item-engine/types.ts IssueStatus — kept as a DB enum
// so invalid statuses can never be persisted, even if application code has a bug.
export const issueStatusEnum = pgEnum("issue_status", [
  "OPEN",
  "AWAITING_AGENT_ACKNOWLEDGEMENT",
  "ACKNOWLEDGED",
  "MONITORING",
  "SUSTAINED",
  "COMPLETED",
  "REOPENED",
]);

// ---------------------------------------------------------------------------
// Org hierarchy
// ---------------------------------------------------------------------------

/**
 * id mirrors Supabase auth.users.id (no default — created alongside the
 * auth user, typically via a DB trigger on auth.users insert, same pattern
 * EWS uses for its `profiles` table).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull(),
  status: userStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  supervisorId: uuid("supervisor_id").references(() => users.id),
  managerId: uuid("manager_id").references(() => users.id),
  site: text("site"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** External employee id from the raw weekly import (RawData.xlsx's EID column). */
  eid: text("eid").notNull().unique(),
  name: text("name").notNull(),
  teamId: uuid("team_id").references(() => teams.id),
  supervisorId: uuid("supervisor_id").references(() => users.id),
  managerId: uuid("manager_id").references(() => users.id),
  site: text("site"),
  skillType: text("skill_type"),
  status: employeeStatusEnum("status").notNull().default("active"),
  /** Set once the employee has their own Agent login. Null until then. */
  userId: uuid("user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// KPI configuration + weekly performance ledger
// ---------------------------------------------------------------------------

export const kpiDefinitions = pgTable("kpi_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: kpiTypeEnum("type").notNull(),
  direction: kpiDirectionEnum("direction").notNull(),
  target: numeric("target"),
  warningThreshold: numeric("warning_threshold"),
  failureThreshold: numeric("failure_threshold"),
  rangeMin: numeric("range_min"),
  rangeMax: numeric("range_max"),
  expectedBoolean: boolean("expected_boolean"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  fileName: text("file_name").notNull(),
  status: importStatusEnum("status").notNull().default("pending"),
  validationSummary: jsonb("validation_summary"),
  rowCounts: jsonb("row_counts"),
});

/**
 * The immutable historical ledger — one row per (employee, kpi, week).
 * Never overwritten; a corrected re-import creates a new source_import_id
 * and a new row, per spec section 21 ("do not overwrite previous weeks").
 */
export const weeklyMetricResults = pgTable(
  "weekly_metric_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    kpiId: uuid("kpi_id").notNull().references(() => kpiDefinitions.id),
    weekStart: date("week_start").notNull(),
    weekEnd: date("week_end").notNull(),
    actualValue: numeric("actual_value").notNull(),
    status: kpiStatusEnum("status").notNull(),
    sourceImportId: uuid("source_import_id").references(() => importBatches.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("weekly_metric_results_employee_kpi_week_idx").on(
      table.employeeId,
      table.kpiId,
      table.weekStart,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Action item engine: performance issues, action items, RCA, action plans
// ---------------------------------------------------------------------------

/**
 * The persistent thread a KPI failure creates (spec section 4). One row per
 * (employee, kpi) failure lineage — never replaced, only updated in place.
 * Mirrors src/lib/action-item-engine — this table is the durable form of
 * PerformanceIssueState; the engine module is the pure logic that computes
 * its transitions.
 */
export const performanceIssues = pgTable("performance_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable human-facing identifier, e.g. PI-2026-000045 (spec section 30). */
  code: text("code").notNull().unique(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  kpiId: uuid("kpi_id").notNull().references(() => kpiDefinitions.id),
  status: issueStatusEnum("status").notNull().default("OPEN"),
  openedWeek: date("opened_week").notNull(),
  consecutivePassingWeeks: integer("consecutive_passing_weeks").notNull().default(0),
  resolvedWeek: date("resolved_week"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Powers the weekly timeline view (spec section 12) — one row per week the issue was evaluated. */
export const weeklyIssueHistory = pgTable("weekly_issue_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  performanceIssueId: uuid("performance_issue_id").notNull().references(() => performanceIssues.id),
  week: date("week").notNull(),
  result: weeklyResultEnum("result").notNull(),
  consecutiveCountAfter: integer("consecutive_count_after").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 1:1 with performance_issues, created together: the issue owns the weekly
 * ledger/consecutive count, the action item owns the RCA/Action
 * Plan/acknowledgement workflow. Reopening flips status in place — the
 * action item's id/code never changes (spec section 30).
 */
export const actionItems = pgTable("action_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable human-facing identifier, e.g. AI-2026-000123 (spec section 30). */
  code: text("code").notNull().unique(),
  performanceIssueId: uuid("performance_issue_id").notNull().unique().references(() => performanceIssues.id),
  status: issueStatusEnum("status").notNull().default("OPEN"),
  dueDate: date("due_date"),
  followUpDate: date("follow_up_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Configurable list from spec section 7. */
export const rootCauseCategories = pgTable("root_cause_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
});

export const rcaEntries = pgTable("rca_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionItemId: uuid("action_item_id").notNull().unique().references(() => actionItems.id),
  problemStatement: text("problem_statement").notNull(),
  rootCauseCategoryId: uuid("root_cause_category_id").notNull().references(() => rootCauseCategories.id),
  rootCauseDetails: text("root_cause_details").notNull(),
  contributingFactors: text("contributing_factors"),
  evidenceNotes: text("evidence_notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const actionPlans = pgTable("action_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionItemId: uuid("action_item_id").notNull().unique().references(() => actionItems.id),
  correctiveAction: text("corrective_action").notNull(),
  expectedBehavior: text("expected_behavior").notNull(),
  targetMetric: text("target_metric").notNull(),
  targetValue: numeric("target_value").notNull(),
  dueDate: date("due_date").notNull(),
  followUpDate: date("follow_up_date").notNull(),
  coachingRequired: boolean("coaching_required").notNull().default(false),
  trainingRequired: boolean("training_required").notNull().default(false),
  supervisorNotes: text("supervisor_notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per acknowledgement *event*, not just the latest — a REOPENED
 * item may require a fresh acknowledgement (spec section 22's audit trail
 * explicitly tracks "when agent acknowledged" as a recurring event).
 */
export const acknowledgements = pgTable("acknowledgements", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionItemId: uuid("action_item_id").notNull().references(() => actionItems.id),
  agentId: uuid("agent_id").notNull().references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Audit trail + notifications
// ---------------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientId: uuid("recipient_id").notNull().references(() => users.id),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations (for typed joins via Drizzle's query API)
// ---------------------------------------------------------------------------

export const employeesRelations = relations(employees, ({ one }) => ({
  team: one(teams, { fields: [employees.teamId], references: [teams.id] }),
  supervisor: one(users, { fields: [employees.supervisorId], references: [users.id] }),
  manager: one(users, { fields: [employees.managerId], references: [users.id] }),
}));

export const performanceIssuesRelations = relations(performanceIssues, ({ one, many }) => ({
  employee: one(employees, { fields: [performanceIssues.employeeId], references: [employees.id] }),
  kpi: one(kpiDefinitions, { fields: [performanceIssues.kpiId], references: [kpiDefinitions.id] }),
  actionItem: one(actionItems, {
    fields: [performanceIssues.id],
    references: [actionItems.performanceIssueId],
  }),
  weeklyHistory: many(weeklyIssueHistory),
}));

export const actionItemsRelations = relations(actionItems, ({ one, many }) => ({
  performanceIssue: one(performanceIssues, {
    fields: [actionItems.performanceIssueId],
    references: [performanceIssues.id],
  }),
  rca: one(rcaEntries, { fields: [actionItems.id], references: [rcaEntries.actionItemId] }),
  actionPlan: one(actionPlans, { fields: [actionItems.id], references: [actionPlans.actionItemId] }),
  acknowledgements: many(acknowledgements),
}));

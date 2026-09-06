import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
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

/**
 * Job title, distinct from the application role. A Team Lead and an SME may
 * both hold the supervisor role for access purposes while doing different
 * jobs, so the two are tracked separately.
 */
export const positionEnum = pgEnum("position", [
  "Supervisor",
  "Manager",
  "Pharmacy Technician",
  "SME",
  "CE",
  "Trainer",
]);

export const kpiTypeEnum = pgEnum("kpi_type", ["percentage", "number", "score", "boolean"]);
export const kpiDirectionEnum = pgEnum("kpi_direction", [
  "higher_is_better",
  "lower_is_better",
  "range",
  "boolean_match",
]);
export const kpiStatusEnum = pgEnum("kpi_status", ["pass", "warning", "fail"]);

/** How a KPI's stored numerator and denominator combine into its value. */
export const kpiAggregationEnum = pgEnum("kpi_aggregation", [
  "ratio", // numerator / denominator
  "ratio_pct", // numerator / denominator * 100
  "inverse_seconds", // denominator / numerator * 3600
  "sum", // numerator
  "derived", // computed from skill/quality facts rather than these two
]);

export const weeklyResultEnum = pgEnum("weekly_result", ["pass", "fail"]);

export const ptoTypeEnum = pgEnum("pto_type", [
  "vacation",
  "sick",
  "emergency",
  "bereavement",
  "unpaid",
]);

/** A request is decided once; "cancelled" is the requester withdrawing it. */
export const ptoStatusEnum = pgEnum("pto_status", ["pending", "approved", "denied", "cancelled"]);

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
  /**
   * Links a login to a person in the source data. Agents are scoped to the
   * employee with this EID; supervisors are scoped to employees whose
   * supervisorEid matches it. Null until an admin links the account.
   */
  employeeEid: text("employee_eid").unique(),
  /**
   * Links a manager login to the manager name used in the source data.
   *
   * The workbook carries no manager EID — managers appear only as a name
   * string on their reports' rows — so a manager's span cannot be keyed on
   * an ID like a supervisor's is. Matching on the account's display name
   * instead looks equivalent but is not: it silently returns nobody when the
   * two spellings differ at all, and it would collide outright for two
   * managers with the same name. This makes the link explicit and set by an
   * administrator, chosen from the names actually present in the data.
   */
  managerName: text("manager_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The 201 file: personnel details captured at sign-up.
 *
 * Kept apart from `users` because it is HR data with a different audience
 * and lifecycle than authentication and role, and because a supervisor
 * viewing their team's 201 file should not require access to account
 * internals.
 */
export const employeeProfiles = pgTable("employee_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  /** Company employee ID, digits with leading zeros preserved. */
  employeeEid: text("employee_eid").notNull(),
  /** Network login, as it appears in the source data (e.g. "mcaumer1"). */
  msid: text("msid"),
  lastName: text("last_name").notNull(),
  firstName: text("first_name").notNull(),
  middleName: text("middle_name"),
  position: positionEnum("position").notNull(),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  cityProvince: text("city_province"),
  country: text("country"),
  zipcode: text("zipcode"),
  phoneNumber: text("phone_number"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactNumber: text("emergency_contact_number"),
  emergencyContactRelationship: text("emergency_contact_relationship"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  supervisorId: uuid("supervisor_id").references(() => users.id),
  managerId: uuid("manager_id").references(() => users.id),
  site: text("site"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** External employee id from the raw weekly import (RawData.xlsx's EID column). */
    eid: text("eid").notNull().unique(),
    name: text("name").notNull(),
    teamId: uuid("team_id").references(() => teams.id),
    supervisorId: uuid("supervisor_id").references(() => users.id),
    managerId: uuid("manager_id").references(() => users.id),
    /**
     * Org hierarchy exactly as the source data expresses it. The raw file
     * identifies supervisors by EID and managers by name only, so these are
     * the authoritative scoping fields; supervisorId/managerId are populated
     * only once matching login accounts exist.
     */
    supervisorEid: text("supervisor_eid"),
    supervisorName: text("supervisor_name"),
    managerName: text("manager_name"),
    site: text("site"),
    skillType: text("skill_type"),
    status: employeeStatusEnum("status").notNull().default("active"),
    /** Set once the employee has their own Agent login. Null until then. */
    userId: uuid("user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A manager's span and a supervisor's team are resolved on nearly every
    // authenticated page load (see employeeScope in src/lib/auth/scope.ts).
    // Cheap to add while the table is small; expensive to add after it isn't.
    index("employees_manager_name_idx").on(table.managerName),
    index("employees_supervisor_eid_idx").on(table.supervisorEid),
  ],
);

/**
 * Who someone reported to during a period, as opposed to right now.
 *
 * `employees` holds one current row, which is what authorization and everyday
 * work should use — you manage the people you manage today. It cannot answer
 * "whose team was this agent on in August", so a realignment silently moved
 * last month's numbers to a supervisor who did not earn them. Reporting
 * roll-ups read this table instead, keyed on the week being reported.
 *
 * Populated from the source workbook, which already carries the supervisor on
 * every weekly row — the import used to collapse them to one value and throw
 * the dates away. A null `effectiveTo` means the assignment is current; the
 * database enforces that two assignments never cover the same day.
 */
export const employeeAssignments = pgTable("employee_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from").notNull(),
  /** Null means still current. */
  effectiveTo: date("effective_to"),
  supervisorEid: text("supervisor_eid"),
  supervisorName: text("supervisor_name"),
  managerName: text("manager_name"),
  site: text("site"),
  sourceImportId: uuid("source_import_id").references(() => importBatches.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  target: numeric("target", { mode: "number" }),
  warningThreshold: numeric("warning_threshold", { mode: "number" }),
  failureThreshold: numeric("failure_threshold", { mode: "number" }),
  rangeMin: numeric("range_min", { mode: "number" }),
  rangeMax: numeric("range_max", { mode: "number" }),
  expectedBoolean: boolean("expected_boolean"),
  /**
   * Whether a failure here opens an action item.
   *
   * False for KPIs that are components of a composite rather than
   * standalone measures: the PAR rating, DPU and DPO are all gates on the
   * MBO result, so MBO is what opens the action item while the components
   * stay visible on the scorecard to show which gate failed.
   */
  generatesActionItems: boolean("generates_action_items").notNull().default(true),
  /**
   * How this KPI's daily facts combine into a value for a reporting period.
   * Stored per KPI because the correct roll-up differs: a rate re-divides
   * its totals, a count sums, and AHT inverts.
   */
  aggregation: kpiAggregationEnum("aggregation").notNull().default("ratio"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * PAR/MBO skill reference data: per-skill target plus the R1-R5 ratio
 * thresholds that drive the 1.00-5.00 rating curve
 * (see src/lib/kpi-engine/par-mbo.ts).
 *
 * Thresholds are stored as decimal ratios (1.2727 = 127.27%) and are fixed
 * scoring policy — only `target` is editable, and only by an admin.
 */
export const skillMetricEnum = pgEnum("skill_metric", ["cph", "aht", "case_rate"]);

export const skillReferences = pgTable("skill_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  target: numeric("target", { mode: "number" }).notNull(),
  /**
   * Which formula produces this skill's measured value, per the source
   * workbook's own Calculated Field definitions:
   *   cph       = cases / productive hours
   *   aht       = (productive hours / cases) * 3600
   *   case_rate = production weight / cases
   *
   * Case rate does not involve hours at all, so treating those skills as
   * cases-per-hour silently scores them against the wrong quantity.
   */
  metric: skillMetricEnum("metric").notNull().default("cph"),
  /** True for skills where a lower actual is better (ratio = target/actual) — the AHT skills. */
  lowerIsBetter: boolean("lower_is_better").notNull().default(false),
  r5: numeric("r5", { mode: "number" }).notNull(),
  r4: numeric("r4", { mode: "number" }).notNull(),
  r3: numeric("r3", { mode: "number" }).notNull(),
  r2: numeric("r2", { mode: "number" }).notNull(),
  r1: numeric("r1", { mode: "number" }).notNull(),
  /**
   * Scored attributes per quality audit, used as the denominator for DPO
   * (defects per opportunity). The source data does not carry this, so it
   * is configuration; 23 is the fallback the existing MBO2 app used.
   */
  attributesPerAudit: integer("attributes_per_audit").notNull().default(23),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A new-hire ramp schedule: one target per stage of onboarding for a skill.
 * Stage 0 is Nesting, 1-8 are Week 1 through Week 8; past stage 8 an
 * employee has completed ramp and the skill's own steady-state target
 * (skillReferences.target) applies, exactly as it does for anyone with no
 * ramp assignment. Organization policy, shared across every new hire on
 * that skill — not per employee, unlike employeeRampAssignments below.
 */
export const skillRampSchedules = pgTable(
  "skill_ramp_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillReferenceId: uuid("skill_reference_id")
      .notNull()
      .references(() => skillReferences.id),
    stage: integer("stage").notNull(),
    target: numeric("target", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("skill_ramp_schedules_skill_stage_idx").on(table.skillReferenceId, table.stage),
  ],
);

/**
 * Which employee is ramping on which skill, and when their stage 0
 * (Nesting) began. Upsert semantics — unique on (employee, skill) — because
 * a supervisor correcting a mistaken start date is the normal case, not an
 * audited event; see src/lib/ramp/engine.ts for how a date resolves to a
 * stage and target.
 */
export const employeeRampAssignments = pgTable(
  "employee_ramp_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    skillReferenceId: uuid("skill_reference_id")
      .notNull()
      .references(() => skillReferences.id),
    /** The Saturday that begins stage 0, matching the source data's own week convention. */
    rampStartWeek: date("ramp_start_week").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("employee_ramp_assignments_employee_skill_idx").on(
      table.employeeId,
      table.skillReferenceId,
    ),
  ],
);

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
    actualValue: numeric("actual_value", { mode: "number" }).notNull(),
    /**
     * The target in force when this week was evaluated. Snapshotted rather
     * than looked up later because KPI targets change over time and history
     * must stay interpretable — and because some targets (CPH/AHT) come per
     * employee from the source data, not from the KPI definition.
     */
    targetValue: numeric("target_value", { mode: "number" }),
    status: kpiStatusEnum("status").notNull(),
    /** Row count behind the aggregate, e.g. number of audits or surveys. */
    sampleSize: integer("sample_size"),
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
// Daily facts
//
// The weekly ledger above is what the action-item engine runs on, because
// the 4-week rule is inherently weekly. These tables keep the same data at
// its source grain so any reporting period — day, week, month, quarter,
// year — can be aggregated correctly.
//
// This matters because most of these measures cannot be averaged across
// periods: quality for a month is total score over total audits, not the
// mean of four weekly percentages. Storing the numerator and denominator
// rather than the computed value is what makes re-aggregation sound.
// ---------------------------------------------------------------------------

export const metricFacts = pgTable(
  "metric_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    kpiId: uuid("kpi_id").notNull().references(() => kpiDefinitions.id),
    factDate: date("fact_date").notNull(),
    numerator: numeric("numerator", { mode: "number" }).notNull(),
    denominator: numeric("denominator", { mode: "number" }).notNull(),
    sampleSize: integer("sample_size").notNull().default(0),
    sourceImportId: uuid("source_import_id").references(() => importBatches.id),
  },
  (table) => [
    uniqueIndex("metric_facts_employee_kpi_date_idx").on(
      table.employeeId,
      table.kpiId,
      table.factDate,
    ),
  ],
);

/** Per-skill production, the input to PAR/MBO scoring at any period. */
export const skillFacts = pgTable(
  "skill_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    /** Skill label as written in the source; resolved through skill_aliases. */
    skillLabel: text("skill_label").notNull(),
    factDate: date("fact_date").notNull(),
    cases: numeric("cases", { mode: "number" }).notNull().default(0),
    hours: numeric("hours", { mode: "number" }).notNull().default(0),
    weightHours: numeric("weight_hours", { mode: "number" }).notNull().default(0),
    prodWeight: numeric("prod_weight", { mode: "number" }).notNull().default(0),
    sourceImportId: uuid("source_import_id").references(() => importBatches.id),
  },
  (table) => [
    uniqueIndex("skill_facts_employee_skill_date_idx").on(
      table.employeeId,
      table.skillLabel,
      table.factDate,
    ),
  ],
);

/**
 * Per-day NPS response mix.
 *
 * The NPS score alone cannot be decomposed: a day's sum and response count
 * give two equations for three unknowns, so promoters, passives and
 * detractors are counted at import time instead of derived later. Without
 * this the agent's own NPS breakdown — and "how many promoters to reach
 * target" — cannot be answered from stored data at all.
 */
export const npsFacts = pgTable(
  "nps_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    factDate: date("fact_date").notNull(),
    promoters: integer("promoters").notNull().default(0),
    passives: integer("passives").notNull().default(0),
    detractors: integer("detractors").notNull().default(0),
    sourceImportId: uuid("source_import_id").references(() => importBatches.id),
  },
  (table) => [
    uniqueIndex("nps_facts_employee_date_idx").on(table.employeeId, table.factDate),
  ],
);

/** Per-skill audit tallies, the input to DPU and DPO at any period. */
export const qualityFacts = pgTable(
  "quality_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    skillLabel: text("skill_label").notNull(),
    factDate: date("fact_date").notNull(),
    audits: integer("audits").notNull().default(0),
    imperfect: integer("imperfect").notNull().default(0),
    markdowns: integer("markdowns").notNull().default(0),
    sourceImportId: uuid("source_import_id").references(() => importBatches.id),
  },
  (table) => [
    uniqueIndex("quality_facts_employee_skill_date_idx").on(
      table.employeeId,
      table.skillLabel,
      table.factDate,
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
export const performanceIssues = pgTable(
  "performance_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable human-facing identifier, e.g. PI-2026-000045 (spec section 30). */
    code: text("code").notNull().unique(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    kpiId: uuid("kpi_id").notNull().references(() => kpiDefinitions.id),
    status: issueStatusEnum("status").notNull().default("OPEN"),
    openedWeek: date("opened_week").notNull(),
    consecutivePassingWeeks: integer("consecutive_passing_weeks").notNull().default(0),
    /**
     * Latest week already folded into this issue's state. Re-importing an
     * earlier or equal week is a no-op, so a corrected re-upload can never
     * double-count a pass or spuriously reopen a resolved issue.
     */
    lastEvaluatedWeek: date("last_evaluated_week"),
    resolvedWeek: date("resolved_week"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Every open-items count or list filters by employee and status together.
    index("performance_issues_employee_status_idx").on(table.employeeId, table.status),
  ],
);

/** Powers the weekly timeline view (spec section 12) — one row per week the issue was evaluated. */
export const weeklyIssueHistory = pgTable(
  "weekly_issue_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    performanceIssueId: uuid("performance_issue_id").notNull().references(() => performanceIssues.id),
    week: date("week").notNull(),
    result: weeklyResultEnum("result").notNull(),
    consecutiveCountAfter: integer("consecutive_count_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("weekly_issue_history_issue_week_idx").on(table.performanceIssueId, table.week)],
);

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

/**
 * Maps a skill label as written in a source workbook onto a configured
 * skill reference.
 *
 * The export names skills differently from the reference table ("General
 * Phone" vs "Gen_Phones", "Outcome Notification" vs "OCN"), and an
 * unmatched label silently drops that work from the employee's PAR rating.
 * Aliases fix that without renaming either side.
 */
export const skillAliases = pgTable("skill_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The label exactly as it appears in the source data. */
  sourceLabel: text("source_label").notNull().unique(),
  skillReferenceId: uuid("skill_reference_id").notNull().references(() => skillReferences.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

/**
 * Dated notes against a root cause.
 *
 * An action item is one persistent thread per (employee, KPI) and carries a
 * single RCA, because a root cause describes the underlying problem rather
 * than the calendar. But an episode can run for weeks and the circumstances
 * can change part-way — August's absences being a scheduling problem and
 * September's an illness, say. Without somewhere to record that, the original
 * RCA silently stands for weeks it no longer explains.
 *
 * Append-only on purpose: this is part of a performance record, so a note is
 * never edited or removed once written.
 */
export const rcaNotes = pgTable(
  "rca_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionItemId: uuid("action_item_id")
      .notNull()
      .references(() => actionItems.id),
    /** The reporting week the note is about. */
    week: date("week").notNull(),
    note: text("note").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("rca_notes_item_week_idx").on(table.actionItemId, table.week)],
);

export const actionPlans = pgTable("action_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionItemId: uuid("action_item_id").notNull().unique().references(() => actionItems.id),
  correctiveAction: text("corrective_action").notNull(),
  expectedBehavior: text("expected_behavior").notNull(),
  targetMetric: text("target_metric").notNull(),
  targetValue: numeric("target_value", { mode: "number" }).notNull(),
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
 * A supervisor's timed observation of one call, segment by segment against a
 * baseline — ported from the standalone LeouDev/Time-Motion tool, for AHT
 * action items specifically: the diagnostic answer to "which part of the
 * call is actually running long" that a bare AHT number cannot give.
 *
 * `segments` is a frozen snapshot ([{code, label, baselineSeconds,
 * actualSeconds, status}]) rather than a join to a live config table. The
 * source tool lets a supervisor edit each baseline before starting the call,
 * so the baseline is an input to one study, not an organizational setting —
 * freezing what was actually measured means a later change to the defaults
 * can never retroactively alter a past study's numbers, the same reason
 * weeklyMetricResults freezes its target rather than reading the KPI
 * definition live.
 *
 * Keyed only on the action item, like rcaEntries and actionPlans — multiple
 * studies can accumulate against one item over time, the same way rcaNotes
 * does, because one observed call rarely settles a recurring AHT issue.
 */
export const timeMotionStudies = pgTable(
  "time_motion_studies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionItemId: uuid("action_item_id").notNull().references(() => actionItems.id),
    /** Optional call reference from the source system, e.g. "CR-0000123". */
    callReference: text("call_reference"),
    segments: jsonb("segments").notNull(),
    totalActualSeconds: integer("total_actual_seconds").notNull(),
    totalBaselineSeconds: integer("total_baseline_seconds").notNull(),
    remarks: text("remarks"),
    performedBy: uuid("performed_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("time_motion_studies_action_item_idx").on(table.actionItemId)],
);

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
// Early Warning System
//
// EWS is deliberately separate from the KPI engine: its indicators are
// qualitative judgements a supervisor makes (job-hunting signals,
// disengagement in huddles, conflicts) and cannot be derived from the
// weekly performance data. It sits alongside the data-driven engine rather
// than being computed from it.
// ---------------------------------------------------------------------------

export const ewsRiskEnum = pgEnum("ews_risk", ["GREEN", "YELLOW", "RED", "BLACK"]);
export const ewsAttritionEnum = pgEnum("ews_attrition", [
  "none",
  "black",
  "absconding",
  "loa",
  "maternity",
]);

/** The configurable indicator taxonomy, seeded from the existing EWS app. */
export const ewsIndicators = pgTable("ews_indicators", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const ewsAssessments = pgTable(
  "ews_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    week: date("week").notNull(),
    /** Indicator code -> flagged, as judged by the supervisor. */
    indicators: jsonb("indicators").notNull().default({}),
    /** Active corrective action plan; counts one point toward the score. */
    capActive: boolean("cap_active").notNull().default(false),
    attrition: ewsAttritionEnum("attrition").notNull().default("none"),
    attritionDate: date("attrition_date"),
    notes: text("notes"),
    /** Derived from the fields above and stored so it can be filtered on. */
    score: integer("score").notNull().default(0),
    riskLevel: ewsRiskEnum("risk_level").notNull().default("GREEN"),
    assessedBy: uuid("assessed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ews_assessments_employee_week_idx").on(table.employeeId, table.week)],
);

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


/**
 * Paid time off, requested by the person taking it and decided by their leader.
 *
 * Dates are inclusive and stored as plain dates rather than timestamps: a day
 * off is a calendar day in the employee's own locale, and a timestamp would
 * make it drift across a timezone boundary.
 *
 * The employee is referenced rather than the user account, because the roster
 * is the source of who reports to whom — an account can exist before it is
 * linked, and leave still belongs to the person.
 */
export const ptoRequests = pgTable(
  "pto_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable human-facing identifier, e.g. PTO-2026-000042. */
    code: text("code").notNull().unique(),
    /**
     * The person taking the leave, when they exist in the imported roster.
     *
     * Null for a supervisor or manager: the workbook contains only agents, so
     * a leader has no employee row and is identified by `requestedBy` instead.
     */
    employeeId: uuid("employee_id").references(() => employees.id),
    /** The account that submitted it; for a leader, also the subject. */
    requestedBy: uuid("requested_by").references(() => users.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    type: ptoTypeEnum("type").notNull().default("vacation"),
    reason: text("reason"),
    status: ptoStatusEnum("status").notNull().default("pending"),
    /** Null until decided. A decision is never made by the requester. */
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pto_requests_employee_idx").on(table.employeeId, table.startDate),
    index("pto_requests_range_idx").on(table.startDate, table.endDate),
  ],
);

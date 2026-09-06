-- Indexes on the columns every authorization check filters by.
--
-- employees.manager_name and employees.supervisor_eid are read on nearly
-- every authenticated page load — they are how a manager's span and a
-- supervisor's team are resolved (see employeeScope in src/lib/auth/scope.ts).
-- performance_issues (employee_id, status) is the other predicate used
-- everywhere an open-items count or list is shown.
--
-- At today's size (452 employees, ~640 issues) a sequential scan is still
-- fast enough that this made no visible difference — but weekly_metric_results
-- and metric_facts already grow by a few thousand rows per week of imports,
-- and performance_issues grows with them. Adding these now is free while the
-- tables are small; adding them after growth means doing it under load.
CREATE INDEX IF NOT EXISTS "employees_manager_name_idx" ON "employees" ("manager_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_supervisor_eid_idx" ON "employees" ("supervisor_eid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_issues_employee_status_idx"
  ON "performance_issues" ("employee_id", "status");

ALTER TABLE "employees" ADD COLUMN "supervisor_eid" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "supervisor_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "manager_name" text;--> statement-breakpoint
ALTER TABLE "performance_issues" ADD COLUMN "last_evaluated_week" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "employee_eid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_issue_history_issue_week_idx" ON "weekly_issue_history" USING btree ("performance_issue_id","week");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_eid_unique" UNIQUE("employee_eid");
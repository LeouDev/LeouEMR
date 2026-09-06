-- Leaders can request leave too, but the imported roster contains only agents:
-- a supervisor appears on their reports' rows as a name, never as an employee.
-- So the subject becomes optional, and a request with no employee row is a
-- leader's own, identified by `requested_by`.
ALTER TABLE "pto_requests" ALTER COLUMN "employee_id" DROP NOT NULL;
--> statement-breakpoint
-- Every request must still identify a subject one way or the other.
ALTER TABLE "pto_requests" ADD CONSTRAINT "pto_requests_has_subject"
  CHECK ("employee_id" IS NOT NULL OR "requested_by" IS NOT NULL);

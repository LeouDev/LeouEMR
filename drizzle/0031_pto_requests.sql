CREATE TYPE "pto_type" AS ENUM ('vacation', 'sick', 'emergency', 'bereavement', 'unpaid');
--> statement-breakpoint
CREATE TYPE "pto_status" AS ENUM ('pending', 'approved', 'denied', 'cancelled');
--> statement-breakpoint
CREATE TABLE "pto_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL UNIQUE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id"),
  "requested_by" uuid REFERENCES "users"("id"),
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "type" "pto_type" DEFAULT 'vacation' NOT NULL,
  "reason" text,
  "status" "pto_status" DEFAULT 'pending' NOT NULL,
  "decided_by" uuid REFERENCES "users"("id"),
  "decided_at" timestamp with time zone,
  "decision_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pto_requests_employee_idx" ON "pto_requests" ("employee_id", "start_date");
--> statement-breakpoint
CREATE INDEX "pto_requests_range_idx" ON "pto_requests" ("start_date", "end_date");
--> statement-breakpoint
-- An inclusive range must not end before it starts; enforced here so a bug in
-- application code cannot persist an impossible request.
ALTER TABLE "pto_requests" ADD CONSTRAINT "pto_requests_dates_ordered" CHECK ("end_date" >= "start_date");
--> statement-breakpoint
-- Same fail-closed baseline as every other table: RLS on, no policies, so the
-- data is reachable only through the server's own connection.
ALTER TABLE "pto_requests" ENABLE ROW LEVEL SECURITY;

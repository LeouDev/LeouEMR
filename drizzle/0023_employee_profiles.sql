CREATE TYPE "public"."position" AS ENUM('Supervisor', 'Manager', 'Pharmacy Technician', 'SME', 'CE', 'Trainer');--> statement-breakpoint
CREATE TABLE "employee_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_eid" text NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"position" "position" NOT NULL,
	"address_line_1" text,
	"address_line_2" text,
	"city_province" text,
	"country" text,
	"zipcode" text,
	"phone_number" text,
	"emergency_contact_name" text,
	"emergency_contact_number" text,
	"emergency_contact_relationship" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
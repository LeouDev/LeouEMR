CREATE TABLE "my_space_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "my_space_notes_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "my_space_notes" ADD CONSTRAINT "my_space_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
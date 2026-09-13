-- A person's own profile picture, uploaded from the profile panel: base64
-- of a 256px image the browser resized, served back by /profile/avatar.
-- Its own table, not a column on users, which is read on every request.
CREATE TABLE IF NOT EXISTS "user_avatars" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	"content_type" text NOT NULL,
	"image" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Fail-closed like every other table: RLS on, reachable only through the
-- app role's own policy (scripts/sql/app-role.sql).
ALTER TABLE "user_avatars" ENABLE ROW LEVEL SECURITY;

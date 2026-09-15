CREATE TYPE "public"."my_space_box" AS ENUM('todos', 'decisions', 'ideas', 'letgo');--> statement-breakpoint
CREATE TABLE "my_space_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"boxes" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "my_space_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"box" "my_space_box" NOT NULL,
	"text" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "my_space_days" ADD CONSTRAINT "my_space_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "my_space_items" ADD CONSTRAINT "my_space_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "my_space_days_user_day_idx" ON "my_space_days" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "my_space_items_user_idx" ON "my_space_items" USING btree ("user_id");
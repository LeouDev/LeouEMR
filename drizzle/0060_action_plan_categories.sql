CREATE TABLE "action_plan_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"group_label" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "action_plan_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "action_plans" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_category_id_action_plan_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."action_plan_categories"("id") ON DELETE no action ON UPDATE no action;
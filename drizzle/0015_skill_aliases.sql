CREATE TABLE "skill_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_label" text NOT NULL,
	"skill_reference_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_aliases_source_label_unique" UNIQUE("source_label")
);
--> statement-breakpoint
ALTER TABLE "skill_aliases" ADD CONSTRAINT "skill_aliases_skill_reference_id_skill_references_id_fk" FOREIGN KEY ("skill_reference_id") REFERENCES "public"."skill_references"("id") ON DELETE no action ON UPDATE no action;
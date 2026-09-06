CREATE TABLE "skill_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"target" numeric NOT NULL,
	"lower_is_better" boolean DEFAULT false NOT NULL,
	"r5" numeric NOT NULL,
	"r4" numeric NOT NULL,
	"r3" numeric NOT NULL,
	"r2" numeric NOT NULL,
	"r1" numeric NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_references_code_unique" UNIQUE("code")
);

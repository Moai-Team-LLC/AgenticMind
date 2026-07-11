ALTER TABLE "skill_versions" ADD COLUMN "completeness_score" real;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "missed" jsonb DEFAULT '[]'::jsonb NOT NULL;
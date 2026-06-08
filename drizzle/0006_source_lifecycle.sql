ALTER TABLE "materials" ADD COLUMN "lifecycle" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "trust_tier" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_lifecycle_check" CHECK ("materials"."lifecycle" IN ('active', 'deprecated', 'superseded', 'archived'));
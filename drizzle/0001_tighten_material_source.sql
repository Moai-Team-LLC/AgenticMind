ALTER TABLE "materials" DROP CONSTRAINT "materials_source_check";--> statement-breakpoint
-- Remap any legacy crawl-connector origins (http_url/google_drive/notion/telegram)
-- to 'manual' before tightening the constraint, so this migration is safe on
-- databases that ingested materials before the connectors were dropped in 0.3.0.
UPDATE "materials" SET "source" = 'manual' WHERE "source" <> 'manual';--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_source_check" CHECK ("materials"."source" IN ('manual'));

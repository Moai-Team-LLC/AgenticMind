ALTER TABLE "chunks" ADD COLUMN "segment_from" integer;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "segment_to" integer;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "start_ms" integer;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "end_ms" integer;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "speaker" text;
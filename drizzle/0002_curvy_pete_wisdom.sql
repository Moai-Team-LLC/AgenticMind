ALTER TABLE "beliefs" ALTER COLUMN "object_tsv" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "beliefs" ALTER COLUMN "object_tsv" DROP EXPRESSION;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "body_tsv" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "body_tsv" DROP EXPRESSION;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ALTER COLUMN "body_tsv" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ALTER COLUMN "body_tsv" DROP EXPRESSION;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "fts_config" text DEFAULT 'simple' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD COLUMN "fts_config" text DEFAULT 'simple' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "fts_config" text DEFAULT 'simple' NOT NULL;
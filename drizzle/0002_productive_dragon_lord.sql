ALTER TABLE "beliefs" drop column "object_tsv";--> statement-breakpoint
ALTER TABLE "beliefs" ADD COLUMN "object_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(object,''))) STORED;--> statement-breakpoint
ALTER TABLE "chunks" drop column "body_tsv";--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "body_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED;--> statement-breakpoint
ALTER TABLE "knowledge_cards" drop column "body_tsv";--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD COLUMN "body_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED;--> statement-breakpoint
-- Recreate the GIN indexes dropped together with the old generated columns
-- (drizzle does not re-emit them since the index definitions are unchanged).
CREATE INDEX "beliefs_object_tsv_idx" ON "beliefs" USING gin ("object_tsv");--> statement-breakpoint
CREATE INDEX "chunks_body_tsv_idx" ON "chunks" USING gin ("body_tsv");--> statement-breakpoint
CREATE INDEX "knowledge_cards_body_tsv_idx" ON "knowledge_cards" USING gin ("body_tsv");
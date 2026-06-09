ALTER TABLE "knowledge_cards" ADD COLUMN "authority" text DEFAULT 'system_inferred' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD COLUMN "confidence_method" text DEFAULT 'llm_extracted' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD COLUMN "confidence_reason" text;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD CONSTRAINT "knowledge_cards_authority_check" CHECK ("knowledge_cards"."authority" IN ('self_declared', 'peer_reported', 'admin_curated', 'system_inferred', 'external_source'));--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD CONSTRAINT "knowledge_cards_confidence_method_check" CHECK ("knowledge_cards"."confidence_method" IN ('llm_extracted', 'rule_based', 'human_curated', 'imported', 'inferred'));
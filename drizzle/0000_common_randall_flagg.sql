CREATE TYPE "public"."principal_kind" AS ENUM('agent', 'service', 'human');--> statement-breakpoint
CREATE TABLE "answer_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_hash" text NOT NULL,
	"question_text" text NOT NULL,
	"question_embedding" vector(1024) NOT NULL,
	"answer_text" text NOT NULL,
	"citations_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_material_ids" uuid[] DEFAULT '{}' NOT NULL,
	"source_fingerprint" text NOT NULL,
	"answer_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ttl_seconds" integer DEFAULT 604800 NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidated_reason" text,
	CONSTRAINT "answer_cache_ttl_check" CHECK ("answer_cache"."ttl_seconds" > 0 AND "answer_cache"."ttl_seconds" <= 2592000)
);
--> statement-breakpoint
CREATE TABLE "ask_cluster_members" (
	"cluster_id" uuid NOT NULL,
	"ask_id" uuid NOT NULL,
	"similarity" real NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_cluster_members_cluster_id_ask_id_pk" PRIMARY KEY("cluster_id","ask_id")
);
--> statement-breakpoint
CREATE TABLE "ask_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"representative_q" text NOT NULL,
	"centroid_embedding" vector(1024) NOT NULL,
	"aggregate_score" real DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"feedback_count" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"promoted_card_id" uuid,
	"veto_reason" text,
	"judge_verdict" text,
	"judge_rationale" text,
	"last_evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_clusters_state_check" CHECK ("ask_clusters"."state" IN ('open', 'ready', 'promoted', 'vetoed'))
);
--> statement-breakpoint
CREATE TABLE "ask_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ask_id" uuid,
	"member_id" text,
	"signal" text NOT NULL,
	"strength" real NOT NULL,
	"source" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_feedback_signal_check" CHECK ("ask_feedback"."signal" IN ('thumb_up', 'thumb_down', 'forwarded_answer', 'thanks_message', 'silent_no_followup', 'no_repeat_in_window', 'reformulated_immediately', 'repeat_question_24h', 'verified_supported', 'verification_failed', 'eval_passed', 'eval_failed', 'downstream_success', 'downstream_failure', 'used_in_generation')),
	CONSTRAINT "ask_feedback_strength_check" CHECK ("ask_feedback"."strength" >= -1.0 AND "ask_feedback"."strength" <= 1.0)
);
--> statement-breakpoint
CREATE TABLE "ask_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text,
	"question_hash" text NOT NULL,
	"served_by" text NOT NULL,
	"retrieval_ms" integer NOT NULL,
	"generation_ms" integer NOT NULL,
	"model" text NOT NULL,
	"citation_count" integer NOT NULL,
	"answer_chars" integer NOT NULL,
	"rerank_used" boolean DEFAULT false NOT NULL,
	"rerank_latency_ms" integer,
	"graph_context_rows" integer DEFAULT 0 NOT NULL,
	"phases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_telemetry_served_by_check" CHECK ("ask_telemetry"."served_by" IN ('cache', 'card_synth', 'synth'))
);
--> statement-breakpoint
CREATE TABLE "beliefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_uuid" text,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"object" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"supersedes" uuid,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_kind" text DEFAULT 'agent' NOT NULL,
	"source_id" text,
	"embedding" vector(1024),
	"object_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(object,''))) STORED,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"body" text NOT NULL,
	"token_count" integer,
	"embedding" vector(1024),
	"embedding_model" text,
	"body_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kg_entities" (
	"entity_id" text PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"type" text NOT NULL,
	"ontology_type" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"extractor_version" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kg_mentions" (
	"material_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"extractor_version" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kg_mentions_material_id_entity_id_pk" PRIMARY KEY("material_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "kg_relations" (
	"from_entity" text NOT NULL,
	"to_entity" text NOT NULL,
	"predicate" text NOT NULL,
	"ontology_predicate" text,
	"confidence" real DEFAULT 0 NOT NULL,
	"extractor_version" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kg_relations_from_entity_to_entity_predicate_pk" PRIMARY KEY("from_entity","to_entity","predicate")
);
--> statement-breakpoint
CREATE TABLE "guard_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_uuid" text,
	"tool" text NOT NULL,
	"reason" text NOT NULL,
	"input_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_value" text NOT NULL,
	"predicate" text,
	"value" text,
	"body" text NOT NULL,
	"question" text,
	"span_start" integer,
	"span_end" integer,
	"confidence" real NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"embedding" vector(1024),
	"embedding_model" text,
	"extractor_version" text,
	"body_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_cards_kind_check" CHECK ("knowledge_cards"."kind" IN ('fact', 'qa', 'definition', 'metric', 'procedure', 'resolution')),
	CONSTRAINT "knowledge_cards_confidence_check" CHECK ("knowledge_cards"."confidence" >= 0.0 AND "knowledge_cards"."confidence" <= 1.0)
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'ingesting' NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"storage_uri" text,
	"source_url" text,
	"created_by" text,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_source_check" CHECK ("materials"."source" IN ('manual', 'http_url', 'google_drive', 'notion', 'telegram')),
	CONSTRAINT "materials_status_check" CHECK ("materials"."status" IN ('ingesting', 'chunking', 'embedding', 'embedded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"user_uuid" text NOT NULL,
	"actor_type" text DEFAULT 'agent' NOT NULL,
	"scopes" text[] DEFAULT '{knowledge:read}'::text[] NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "principal_kind" DEFAULT 'agent' NOT NULL,
	"external_id" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_cluster_members" ADD CONSTRAINT "ask_cluster_members_cluster_id_ask_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."ask_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_cluster_members" ADD CONSTRAINT "ask_cluster_members_ask_id_ask_telemetry_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."ask_telemetry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_clusters" ADD CONSTRAINT "ask_clusters_promoted_card_id_knowledge_cards_id_fk" FOREIGN KEY ("promoted_card_id") REFERENCES "public"."knowledge_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_feedback" ADD CONSTRAINT "ask_feedback_ask_id_ask_telemetry_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."ask_telemetry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_mentions" ADD CONSTRAINT "kg_mentions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_mentions" ADD CONSTRAINT "kg_mentions_entity_id_kg_entities_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."kg_entities"("entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_relations" ADD CONSTRAINT "kg_relations_from_entity_kg_entities_entity_id_fk" FOREIGN KEY ("from_entity") REFERENCES "public"."kg_entities"("entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_relations" ADD CONSTRAINT "kg_relations_to_entity_kg_entities_entity_id_fk" FOREIGN KEY ("to_entity") REFERENCES "public"."kg_entities"("entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD CONSTRAINT "knowledge_cards_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_cache_active_hash_uniq" ON "answer_cache" USING btree ("question_hash") WHERE invalidated_at IS NULL;--> statement-breakpoint
CREATE INDEX "answer_cache_question_embedding_idx" ON "answer_cache" USING diskann ("question_embedding" vector_cosine_ops) WHERE invalidated_at IS NULL;--> statement-breakpoint
CREATE INDEX "answer_cache_source_ids_gin_idx" ON "answer_cache" USING gin ("source_material_ids") WHERE invalidated_at IS NULL;--> statement-breakpoint
CREATE INDEX "answer_cache_created_at_idx" ON "answer_cache" USING btree ("created_at") WHERE invalidated_at IS NULL;--> statement-breakpoint
CREATE INDEX "ask_cluster_members_ask_id_idx" ON "ask_cluster_members" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "ask_clusters_centroid_idx" ON "ask_clusters" USING diskann ("centroid_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "ask_clusters_state_idx" ON "ask_clusters" USING btree ("state","aggregate_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ask_clusters_updated_at_idx" ON "ask_clusters" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ask_feedback_ask_id_idx" ON "ask_feedback" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "ask_feedback_member_time_idx" ON "ask_feedback" USING btree ("member_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ask_feedback_created_at_idx" ON "ask_feedback" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ask_telemetry_created_at_idx" ON "ask_telemetry" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ask_telemetry_served_by_time_idx" ON "ask_telemetry" USING btree ("served_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ask_telemetry_question_time_idx" ON "ask_telemetry" USING btree ("question_hash","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "beliefs_actor_subject_idx" ON "beliefs" USING btree ("actor_uuid","subject");--> statement-breakpoint
CREATE INDEX "beliefs_subject_predicate_idx" ON "beliefs" USING btree ("subject","predicate");--> statement-breakpoint
CREATE INDEX "beliefs_current_idx" ON "beliefs" USING btree ("invalidated_at","valid_to");--> statement-breakpoint
CREATE INDEX "beliefs_embedding_idx" ON "beliefs" USING diskann ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "beliefs_object_tsv_idx" ON "beliefs" USING gin ("object_tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_material_ordinal_uniq" ON "chunks" USING btree ("material_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_material_id_idx" ON "chunks" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING diskann ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_body_tsv_idx" ON "chunks" USING gin ("body_tsv");--> statement-breakpoint
CREATE INDEX "kg_entities_canonical_name_idx" ON "kg_entities" USING btree ("canonical_name");--> statement-breakpoint
CREATE INDEX "kg_entities_ontology_type_idx" ON "kg_entities" USING btree ("ontology_type");--> statement-breakpoint
CREATE INDEX "kg_mentions_entity_id_idx" ON "kg_mentions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "kg_relations_from_idx" ON "kg_relations" USING btree ("from_entity");--> statement-breakpoint
CREATE INDEX "kg_relations_to_idx" ON "kg_relations" USING btree ("to_entity");--> statement-breakpoint
CREATE INDEX "guard_events_actor_time_idx" ON "guard_events" USING btree ("actor_uuid","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "guard_events_reason_time_idx" ON "guard_events" USING btree ("reason","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "knowledge_cards_material_id_idx" ON "knowledge_cards" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "knowledge_cards_subject_idx" ON "knowledge_cards" USING btree ("subject_type","subject_value");--> statement-breakpoint
CREATE INDEX "knowledge_cards_kind_confidence_idx" ON "knowledge_cards" USING btree ("kind","confidence");--> statement-breakpoint
CREATE INDEX "knowledge_cards_extractor_version_idx" ON "knowledge_cards" USING btree ("extractor_version","material_id");--> statement-breakpoint
CREATE INDEX "knowledge_cards_embedding_idx" ON "knowledge_cards" USING diskann ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_cards_body_tsv_idx" ON "knowledge_cards" USING gin ("body_tsv");--> statement-breakpoint
CREATE INDEX "materials_status_idx" ON "materials" USING btree ("status");--> statement-breakpoint
CREATE INDEX "materials_source_idx" ON "materials" USING btree ("source");--> statement-breakpoint
CREATE INDEX "materials_created_by_idx" ON "materials" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "materials_created_at_idx" ON "materials" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "materials_title_trgm_idx" ON "materials" USING gin (lower("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "mcp_tokens_user_uuid_idx" ON "mcp_tokens" USING btree ("user_uuid","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mcp_tokens_active_idx" ON "mcp_tokens" USING btree ("revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "users_external_id_idx" ON "users" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "users_kind_idx" ON "users" USING btree ("kind");
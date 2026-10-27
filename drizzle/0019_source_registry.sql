CREATE TABLE "knowledge_sources" (
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" text DEFAULT 'default' NOT NULL,
	"source_type" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"knowledge_type" text DEFAULT 'canonical' NOT NULL,
	"fts_config" text DEFAULT 'simple' NOT NULL,
	"visibility" text DEFAULT 'workspace' NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner" text,
	"current_revision_id" uuid,
	"latest_external_version" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_sources_knowledge_type_check" CHECK ("knowledge_sources"."knowledge_type" IN ('canonical', 'evidence', 'inference')),
	CONSTRAINT "knowledge_sources_visibility_check" CHECK ("knowledge_sources"."visibility" IN ('workspace', 'restricted', 'personal'))
);
--> statement-breakpoint
CREATE TABLE "source_revisions" (
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"content_hash" text NOT NULL,
	"external_version" bigint,
	"occurred_at" timestamp with time zone,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_text" text NOT NULL,
	"segments" jsonb,
	"provenance" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"material_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD COLUMN "revision_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_current_revision_id_source_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."source_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_revisions" ADD CONSTRAINT "source_revisions_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_revisions" ADD CONSTRAINT "source_revisions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_identity_uidx" ON "knowledge_sources" USING btree ("tenant_id","connection_id","source_type","external_id");--> statement-breakpoint
CREATE INDEX "knowledge_sources_type_idx" ON "knowledge_sources" USING btree ("source_type");--> statement-breakpoint
CREATE UNIQUE INDEX "source_revisions_source_no_uidx" ON "source_revisions" USING btree ("source_id","revision_no");--> statement-breakpoint
CREATE INDEX "source_revisions_source_hash_idx" ON "source_revisions" USING btree ("source_id","content_hash");--> statement-breakpoint
CREATE INDEX "source_revisions_material_idx" ON "source_revisions" USING btree ("material_id");--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_revision_id_source_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."source_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_jobs_revision_idx" ON "ingestion_jobs" USING btree ("revision_id");--> statement-breakpoint
-- Tenant isolation, forced like materials/chunks: every read and write of a
-- source or revision, the worker's included, runs under its tenant.
ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "knowledge_sources" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);--> statement-breakpoint
ALTER TABLE "source_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "source_revisions" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);

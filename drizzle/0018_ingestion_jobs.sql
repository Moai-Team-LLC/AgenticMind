CREATE TABLE "ingestion_jobs" (
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'index_material' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'index' NOT NULL,
	"material_id" uuid,
	"created_by" text,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"coverage" jsonb,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ingestion_jobs_status_check" CHECK ("ingestion_jobs"."status" IN ('queued', 'indexing', 'text_ready', 'ready', 'retry_wait', 'failed', 'superseded', 'retracted')),
	CONSTRAINT "ingestion_jobs_stage_check" CHECK ("ingestion_jobs"."stage" IN ('index', 'cards', 'graph', 'done'))
);
--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_jobs_claim_idx" ON "ingestion_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ingestion_jobs_material_idx" ON "ingestion_jobs" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_jobs_tenant_dedupe_uidx" ON "ingestion_jobs" USING btree ("tenant_id","dedupe_key") WHERE "ingestion_jobs"."dedupe_key" IS NOT NULL;--> statement-breakpoint
-- Tenant isolation for the app role. Enabled, not forced: the worker connects as
-- the table owner to claim jobs of every tenant, then runs each stage under the
-- job's tenant, where the forced policies on materials/chunks/cards apply.
ALTER TABLE "ingestion_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ingestion_jobs" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);

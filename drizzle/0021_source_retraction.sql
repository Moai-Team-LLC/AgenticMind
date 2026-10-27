CREATE TABLE "source_events" (
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_events_kind_check" CHECK ("source_events"."kind" IN ('retracted', 'resurrected', 'purged', 'unavailable', 'available'))
);
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "tombstoned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "tombstone_reason" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "available" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "availability_reason" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "availability_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_events_source_idx" ON "source_events" USING btree ("source_id","created_at");--> statement-breakpoint
ALTER TABLE "source_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "source_events" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);

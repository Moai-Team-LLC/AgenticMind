ALTER TABLE "answer_cache" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_cluster_members" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_clusters" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_feedback" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_telemetry" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "beliefs" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "kg_entities" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "kg_mentions" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "kg_relations" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "guard_events" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_cards" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_limits" ADD COLUMN "tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "answer_cache" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "answer_cache" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "answer_cache" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "ask_cluster_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ask_cluster_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ask_cluster_members" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "ask_clusters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ask_clusters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ask_clusters" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "ask_feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ask_feedback" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ask_feedback" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "ask_telemetry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ask_telemetry" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ask_telemetry" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "beliefs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "beliefs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "beliefs" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chunks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "chunks" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "kg_entities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "kg_entities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "kg_entities" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "kg_mentions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "kg_mentions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "kg_mentions" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "kg_relations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "kg_relations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "kg_relations" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "guard_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "guard_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "guard_events" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "knowledge_cards" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_cards" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "knowledge_cards" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "materials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "materials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "materials" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rate_limits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rate_limits" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);

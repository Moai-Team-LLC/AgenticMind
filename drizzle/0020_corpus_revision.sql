CREATE TABLE "knowledge_corpus" (
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_corpus_tenant_uidx" ON "knowledge_corpus" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "knowledge_corpus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_corpus" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "knowledge_corpus" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);

CREATE TABLE "kg_entities" (
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
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
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"extractor_version" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kg_mentions_material_id_entity_id_pk" PRIMARY KEY("material_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "kg_relations" (
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
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
ALTER TABLE "ask_telemetry" ADD COLUMN "graph_context_rows" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "kg_mentions" ADD CONSTRAINT "kg_mentions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_mentions" ADD CONSTRAINT "kg_mentions_entity_id_kg_entities_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."kg_entities"("entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_relations" ADD CONSTRAINT "kg_relations_from_entity_kg_entities_entity_id_fk" FOREIGN KEY ("from_entity") REFERENCES "public"."kg_entities"("entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kg_relations" ADD CONSTRAINT "kg_relations_to_entity_kg_entities_entity_id_fk" FOREIGN KEY ("to_entity") REFERENCES "public"."kg_entities"("entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kg_entities_canonical_name_idx" ON "kg_entities" USING btree ("canonical_name");--> statement-breakpoint
CREATE INDEX "kg_entities_ontology_type_idx" ON "kg_entities" USING btree ("ontology_type");--> statement-breakpoint
CREATE INDEX "kg_mentions_entity_id_idx" ON "kg_mentions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "kg_relations_from_idx" ON "kg_relations" USING btree ("from_entity");--> statement-breakpoint
CREATE INDEX "kg_relations_to_idx" ON "kg_relations" USING btree ("to_entity");--> statement-breakpoint
ALTER TABLE "kg_entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kg_entities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "kg_entities" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);--> statement-breakpoint
ALTER TABLE "kg_mentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kg_mentions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "kg_mentions" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);--> statement-breakpoint
ALTER TABLE "kg_relations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kg_relations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "kg_relations" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
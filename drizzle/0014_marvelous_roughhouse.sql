CREATE TABLE "skill_versions" (
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" text NOT NULL,
	"corpus_snapshot_id" text NOT NULL,
	"extractor_model" text NOT NULL,
	"extractor_version" text NOT NULL,
	"judge_model" text NOT NULL,
	"judge_version_hash" text NOT NULL,
	"eval_pass_rate" real NOT NULL,
	"passed" boolean NOT NULL,
	"md" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contradicted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"git_sha" text,
	"compiled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"tenant_id" uuid DEFAULT coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_skill_snapshot_uidx" ON "skill_versions" USING btree ("skill_id","corpus_snapshot_id");--> statement-breakpoint
CREATE INDEX "skill_versions_skill_created_idx" ON "skill_versions" USING btree ("skill_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "skills_tenant_target_uidx" ON "skills" USING btree ("tenant_id","target");--> statement-breakpoint
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "skills" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);--> statement-breakpoint
ALTER TABLE "skill_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "skill_versions" USING ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid) WITH CHECK ("tenant_id" = coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid);
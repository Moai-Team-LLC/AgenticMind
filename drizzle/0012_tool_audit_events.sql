CREATE TABLE "tool_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"event_kind" text NOT NULL,
	"actor_uuid" text,
	"session_id" text,
	"tool" text,
	"decision" text,
	"payload_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tool_audit_events_source_time_idx" ON "tool_audit_events" USING btree ("source","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tool_audit_events_session_time_idx" ON "tool_audit_events" USING btree ("session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tool_audit_events_actor_time_idx" ON "tool_audit_events" USING btree ("actor_uuid","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tool_audit_events_created_at_idx" ON "tool_audit_events" USING btree ("created_at" DESC NULLS LAST);
CREATE TABLE "assurance_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"critical_drift" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assurance_runs_target_time_idx" ON "assurance_runs" USING btree ("target","created_at" DESC NULLS LAST);
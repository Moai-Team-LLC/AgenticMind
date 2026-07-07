/**
 * AgenticMind worker — Postgres-only, no broker. The single background task is
 * the Tier-4 compounding sweep, scheduled daily via a Postgres advisory lock
 * (see jobs/knowledge-feedback/worker.ts). Durable scheduling lives in Postgres
 * itself — there is no separate queue or message broker to run.
 */

import { startAssuranceDriftScheduler } from "@/jobs/assurance-drift/worker"
import { startKnowledgeFeedbackScheduler } from "@/jobs/knowledge-feedback/worker"
import { initTracing } from "@/tracing"

// Register the OTLP trace exporter before scheduling, if configured (no-op otherwise).
initTracing()

const scheduler = startKnowledgeFeedbackScheduler()
const driftScheduler = startAssuranceDriftScheduler()

const shutdown = (): void => {
  console.log(`[WORKER] ${new Date().toISOString()}: shutting down…`)
  scheduler.stop()
  driftScheduler.stop()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

console.log(
  `[WORKER] ${new Date().toISOString()}: AgenticMind worker ready (Postgres-scheduled feedback + assurance-drift sweeps).`,
)

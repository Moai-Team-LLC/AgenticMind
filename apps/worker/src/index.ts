/**
 * AgenticMind worker — Postgres-only, no broker. The single background task is
 * the Tier-4 compounding sweep, scheduled daily via a Postgres advisory lock
 * (see jobs/knowledge-feedback/worker.ts). The source product's other jobs and
 * its Redis/BullMQ broker were removed in the extraction — the flagship runs on
 * Postgres + pgvector alone.
 */

import { startKnowledgeFeedbackScheduler } from "@/jobs/knowledge-feedback/worker"
import { initTracing } from "@/tracing"

// Register the OTLP trace exporter before scheduling, if configured (no-op otherwise).
initTracing()

const scheduler = startKnowledgeFeedbackScheduler()

const shutdown = (): void => {
  console.log(`[WORKER] ${new Date().toISOString()}: shutting down…`)
  scheduler.stop()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

console.log(
  `[WORKER] ${new Date().toISOString()}: AgenticMind worker ready (Postgres-scheduled feedback sweep).`,
)

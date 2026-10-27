/**
 * AgenticMind worker — Postgres-only, no broker. It runs the Tier-4
 * compounding sweep (daily, under a Postgres advisory lock — see
 * jobs/knowledge-feedback/worker.ts), the drift and HITL sweeps, and the
 * background ingestion jobs (jobs/ingestion/worker.ts). Durable scheduling lives
 * in Postgres itself — there is no separate queue or message broker to run.
 */

import { resolveActiveProfile } from "@agenticmind/shared/lib/profile"

import { initTracing } from "@/tracing"

// Register the OTLP trace exporter before scheduling, if configured (no-op otherwise).
initTracing()

// Same boot rule as the server: an unknown AGENTICMIND_PROFILE refuses to start.
const profile = resolveActiveProfile()
if (profile.isErr()) {
  console.error(`[WORKER] ${profile.error.message} — refusing to start`)
  process.exit(1)
}
console.log(`[WORKER] profile: ${profile.value}`)

// The job modules open the database pool when they load (lib/database.ts), and
// the pool refuses unverified TLS in strict. Load them only after the profile
// check, and turn a refusal at load into the same clean message as above.
const loadJobs = async () =>
  Promise.all([
    import("@/jobs/knowledge-feedback/worker"),
    import("@/jobs/assurance-drift/worker"),
    import("@/jobs/hitl-expiry/worker"),
    import("@/jobs/hitl-resume/worker"),
    import("@/jobs/ingestion/worker"),
  ])
let jobs: Awaited<ReturnType<typeof loadJobs>>
try {
  jobs = await loadJobs()
} catch (error) {
  console.error(
    `[WORKER] ${error instanceof Error ? error.message : String(error)} — refusing to start`,
  )
  process.exit(1)
}
const [
  { startKnowledgeFeedbackScheduler },
  { startAssuranceDriftScheduler },
  { startHitlExpiryScheduler },
  { startHitlResumeScheduler },
  { startIngestionScheduler },
] = jobs

const scheduler = startKnowledgeFeedbackScheduler()
const driftScheduler = startAssuranceDriftScheduler()
const hitlExpiryScheduler = startHitlExpiryScheduler()
const hitlResumeScheduler = startHitlResumeScheduler()
const ingestionScheduler = startIngestionScheduler()

const shutdown = (): void => {
  console.log(`[WORKER] ${new Date().toISOString()}: shutting down…`)
  scheduler.stop()
  driftScheduler.stop()
  hitlExpiryScheduler.stop()
  hitlResumeScheduler.stop()
  ingestionScheduler.stop()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

console.log(
  `[WORKER] ${new Date().toISOString()}: AgenticMind worker ready (Postgres-scheduled feedback + assurance-drift + hitl-expiry + hitl-resume sweeps + ingestion jobs).`,
)

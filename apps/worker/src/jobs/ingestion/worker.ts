/**
 * Background ingestion loop (contract 1.11.0). Polls `ingestion_jobs` and runs
 * what it claims through the shared runner (lib/knowledge/ingestion-runner.ts).
 * Replicas need no coordination beyond Postgres: a claim takes a lease with
 * FOR UPDATE SKIP LOCKED, so two workers never run the same job at once, and a
 * dead worker's job is picked up again once its lease expires.
 */

import { runIngestionTick } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import { randomUUID } from "node:crypto"
import { hostname } from "node:os"

import { db } from "@/lib/database"

/** Idle poll interval; a tick that found work polls again at once. */
const POLL_INTERVAL_MS = 2000
/** Jobs run concurrently per worker process. */
const CONCURRENCY = 2

export const startIngestionScheduler = (): { stop: () => void } => {
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const schedule = (delay: number): void => {
    timer = setTimeout(() => {
      void (async () => {
        let ran = 0
        try {
          ran = await runIngestionTick({ db, workerId }, CONCURRENCY)
        } catch (error: unknown) {
          console.error("[WORKER] ingestion tick error:", error)
        } finally {
          if (!stopped) {
            schedule(ran > 0 ? 0 : POLL_INTERVAL_MS)
          }
        }
      })()
    }, delay)
  }
  schedule(POLL_INTERVAL_MS)
  console.log(`[WORKER] ingestion runner ${workerId}: polling every ${POLL_INTERVAL_MS} ms`)
  return {
    stop: () => {
      stopped = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    },
  }
}

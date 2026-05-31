/**
 * Postgres-native scheduler for the Tier-4 compounding sweep. No broker: a
 * daily timer fires at 04:00 UTC, takes a Postgres advisory lock (so only one
 * instance runs the sweep even in a multi-replica deploy), runs it, releases
 * the lock, and reschedules. This is why the flagship needs no Redis.
 */

import { sql } from "drizzle-orm"

import { runKnowledgeFeedbackSweep } from "@/jobs/knowledge-feedback/handler"
import { db } from "@/lib/database"

/** Arbitrary fixed key identifying the feedback-sweep advisory lock. */
const ADVISORY_LOCK_KEY = 4_242_042
const DAILY_HOUR_UTC = 4

const msUntilNextRun = (now: Date): number => {
  const next = new Date(now)
  next.setUTCHours(DAILY_HOUR_UTC, 0, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next.getTime() - now.getTime()
}

/** Runs the sweep iff this instance wins the advisory lock. */
const runGuarded = async (): Promise<void> => {
  const res = await db.execute(sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`)
  const locked = (res.rows[0] as { locked?: boolean } | undefined)?.locked === true
  if (!locked) {
    console.log(`[WORKER] ${new Date().toISOString()}: sweep lock held elsewhere — skipping`)
    return
  }
  try {
    await runKnowledgeFeedbackSweep(db)
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`)
  }
}

/** Starts the daily scheduler. Returns a stop handle for graceful shutdown. */
export const startKnowledgeFeedbackScheduler = (): { stop: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (): void => {
    const delay = msUntilNextRun(new Date())
    console.log(
      `[WORKER] ${new Date().toISOString()}: next knowledge-feedback sweep in ~${Math.round(delay / 60_000)} min`,
    )
    timer = setTimeout(() => {
      void (async () => {
        try {
          await runGuarded()
        } catch (error: unknown) {
          console.error("[WORKER] knowledge-feedback sweep error:", error)
        } finally {
          schedule()
        }
      })()
    }, delay)
  }
  schedule()
  return {
    stop: () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    },
  }
}

/**
 * Postgres-native scheduler for the continuous-assurance drift sweep (FR-10). Mirrors the
 * knowledge-feedback scheduler: a daily timer, a Postgres advisory lock so exactly one replica runs
 * the sweep, then release + reschedule. No broker. Runs an hour after the feedback sweep to avoid
 * contending for the same connection burst.
 */

import {
  consoleNotifier,
  makeTelegramNotifier,
  type AssuranceNotifier,
} from "@agenticmind/assurance"
import { sql } from "drizzle-orm"

import { runAssuranceDriftSweep } from "@/jobs/assurance-drift/handler"
import { db } from "@/lib/database"

/** Fixed key identifying the assurance-drift advisory lock (distinct from the feedback sweep). */
const ADVISORY_LOCK_KEY = 4_242_043
const DAILY_HOUR_UTC = 5

/**
 * Drift alerts go to Telegram when both env vars are set, else a console logger. Resolved at the
 * composition root (env is app config), so the sweep and the adapter stay pure and injectable.
 */
// oxlint-disable-next-line node/no-process-env
const TELEGRAM_BOT_TOKEN = process.env.ASSURANCE_TELEGRAM_BOT_TOKEN
// oxlint-disable-next-line node/no-process-env
const TELEGRAM_CHAT_ID = process.env.ASSURANCE_TELEGRAM_CHAT_ID
const notifier: AssuranceNotifier =
  TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID
    ? makeTelegramNotifier({ botToken: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID })
    : consoleNotifier

const msUntilNextRun = (now: Date): number => {
  const next = new Date(now)
  next.setUTCHours(DAILY_HOUR_UTC, 0, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next.getTime() - now.getTime()
}

/**
 * Runs the sweep iff this instance wins the advisory lock. The lock is taken INSIDE a transaction so
 * it lives on one pinned pool connection: `pg_try_advisory_xact_lock` is transaction-scoped and
 * auto-releases on commit/rollback. Acquiring a session lock on a pool and unlocking it on a
 * different pooled connection would orphan it and silently wedge the sweep forever — so we don't.
 */
const runGuarded = async (): Promise<void> => {
  await db.transaction(async (tx) => {
    const res = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS locked`,
    )
    const locked = (res.rows[0] as { locked?: boolean } | undefined)?.locked === true
    if (!locked) {
      console.log(
        `[WORKER] ${new Date().toISOString()}: assurance-drift lock held elsewhere — skipping`,
      )
      return
    }
    await runAssuranceDriftSweep(tx, notifier)
  })
}

/** Starts the daily scheduler. Returns a stop handle for graceful shutdown. */
export const startAssuranceDriftScheduler = (): { stop: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (): void => {
    const delay = msUntilNextRun(new Date())
    console.log(
      `[WORKER] ${new Date().toISOString()}: next assurance-drift sweep in ~${Math.round(delay / 60_000)} min`,
    )
    timer = setTimeout(() => {
      void (async () => {
        try {
          await runGuarded()
        } catch (error: unknown) {
          console.error("[WORKER] assurance-drift sweep error:", error)
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

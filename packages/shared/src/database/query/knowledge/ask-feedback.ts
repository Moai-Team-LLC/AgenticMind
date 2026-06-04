/**
 * Feedback event repository — record / list-since / count-by-ask surface. One
 * row per /ask feedback signal; the cluster builder scans recent rows. Strength
 * is clamped to [-1, 1] on write.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { FeedbackSignal } from "@agenticmind/shared/lib/knowledge/feedback"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { askFeedback } from "@agenticmind/shared/database/schema"
import { clampStrength } from "@agenticmind/shared/lib/knowledge/feedback"
import { asc, eq, gt, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type RecordEventInput = {
  askId?: string | null
  memberId?: string | null
  signal: FeedbackSignal
  strength: number
  source: string
  metadata?: Record<string, unknown>
}

/** Writes one feedback event (strength clamped to [-1, 1]). */
export const recordEvent = (props: { tx: Transaction; event: RecordEventInput }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [created] = await props.tx
        .insert(askFeedback)
        .values({
          askId: props.event.askId ?? null,
          memberId: props.event.memberId ?? null,
          signal: props.event.signal,
          strength: clampStrength(props.event.strength),
          source: props.event.source,
          metadata: props.event.metadata ?? {},
        })
        .returning()
      return created ?? null
    })(),
    mapDatabaseError,
  )

/** Events created after `since`, oldest first (cluster builder sweep). */
export const listEventsSince = (props: { tx: Transaction; since: Date; limit?: number }) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 5000 ? props.limit : 1000
  return ResultAsync.fromPromise(
    props.tx
      .select()
      .from(askFeedback)
      .where(gt(askFeedback.createdAt, props.since))
      .orderBy(asc(askFeedback.createdAt))
      .limit(limit),
    mapDatabaseError,
  )
}

/** Count of feedback events recorded for an ask. */
export const countEventsByAsk = (props: { tx: Transaction; askId: string }) =>
  ResultAsync.fromPromise(
    props.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(askFeedback)
      .where(eq(askFeedback.askId, props.askId)),
    mapDatabaseError,
  ).map((rows) => rows[0]?.count ?? 0)

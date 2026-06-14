/**
 * Ask telemetry repository. One audit row per /ask answer: latency/cost by
 * served_by path, citation/answer sizes, rerank + graph-context usage. Privacy:
 * by default only the sha256 of the normalised question is stored, never the
 * text — UNLESS the opt-in eval-harvest flag (KNOWLEDGE_EVAL_HARVEST) is set, in
 * which case the raw question is also kept so signalled real queries can be
 * replayed by the corpus-adaptive tuner. Best-effort — a write failure must
 * never degrade the answer (callers swallow the error).
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { StatusCount } from "@agenticmind/shared/lib/eval/health"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { askFeedback, askTelemetry } from "@agenticmind/shared/database/schema"
import { desc, eq, gt, isNotNull, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type AskTelemetryEvent = {
  memberId?: string | null
  questionHash: string
  /** Raw question text — set only under the opt-in eval-harvest flag (else null). */
  questionText?: string | null
  /** Cache | card_synth | synth (enforced by the table check constraint). */
  servedBy: string
  /** Self-reported trust verdict, persisted for the fleet health/drift monitor. */
  status?: string | null
  retrievalMs: number
  generationMs: number
  model: string
  citationCount: number
  answerChars: number
  rerankUsed?: boolean
  rerankLatencyMs?: number | null
  graphContextRows?: number
  phases?: { phase: string; ms: number }[]
}

/** Inserts one telemetry row and returns its id. */
export const recordAskTelemetry = (props: { tx: Transaction; event: AskTelemetryEvent }) =>
  ResultAsync.fromPromise(
    (async (): Promise<{ id: string }> => {
      const [created] = await props.tx
        .insert(askTelemetry)
        .values({
          memberId: props.event.memberId ?? null,
          questionHash: props.event.questionHash,
          questionText: props.event.questionText ?? null,
          servedBy: props.event.servedBy,
          status: props.event.status ?? null,
          retrievalMs: Math.max(0, Math.round(props.event.retrievalMs)),
          generationMs: Math.max(0, Math.round(props.event.generationMs)),
          model: props.event.model,
          citationCount: props.event.citationCount,
          answerChars: props.event.answerChars,
          rerankUsed: props.event.rerankUsed ?? false,
          rerankLatencyMs:
            props.event.rerankLatencyMs !== undefined && props.event.rerankLatencyMs !== null
              ? Math.max(0, Math.round(props.event.rerankLatencyMs))
              : null,
          graphContextRows: props.event.graphContextRows ?? 0,
          phases: props.event.phases ?? [],
        })
        .returning({ id: askTelemetry.id })
      return created ?? { id: "" }
    })(),
    mapDatabaseError,
  )

/** Per-status answer counts since `since` — input to the fleet health monitor. */
export const askHealthSince = (props: { tx: Transaction; since: Date }) =>
  ResultAsync.fromPromise(
    props.tx
      .select({ status: askTelemetry.status, count: sql<number>`count(*)::int` })
      .from(askTelemetry)
      .where(gt(askTelemetry.createdAt, props.since))
      .groupBy(askTelemetry.status),
    mapDatabaseError,
  ).map((rows): StatusCount[] =>
    rows.map((r) => {
      return { status: r.status, count: r.count }
    }),
  )

/** A harvested production query and the net of the agent signals it received. */
export type HarvestedQuery = { questionText: string; netStrength: number }

/**
 * Harvests questions that (a) were captured under the opt-in eval-harvest flag
 * (question_text IS NOT NULL) and (b) earned a net-positive sum of feedback
 * signals — real, agent-validated queries the corpus-adaptive tuner can replay
 * as regression cases. Net strength ≤ 0 (failed/contested) is excluded.
 */
export const harvestSignalledQueries = (props: { tx: Transaction; limit?: number }) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 2000 ? props.limit : 500
  const net = sql<number>`sum(${askFeedback.strength})::float`
  return ResultAsync.fromPromise(
    props.tx
      .select({ questionText: sql<string>`${askTelemetry.questionText}`, netStrength: net })
      .from(askTelemetry)
      .innerJoin(askFeedback, eq(askFeedback.askId, askTelemetry.id))
      .where(isNotNull(askTelemetry.questionText))
      .groupBy(askTelemetry.id, askTelemetry.questionText)
      .having(sql`sum(${askFeedback.strength}) > 0`)
      .orderBy(desc(net))
      .limit(limit),
    mapDatabaseError,
  )
}

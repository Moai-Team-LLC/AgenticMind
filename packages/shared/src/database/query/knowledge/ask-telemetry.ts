/**
 * Ask telemetry repository — ported from services/knowledge/internal/telemetry
 * (ask.go). One audit row per /ask answer: latency/cost by served_by path,
 * citation/answer sizes, rerank + graph-context usage. Privacy: only the
 * sha256 of the normalised question is stored, never the text. Best-effort —
 * a write failure must never degrade the answer (callers swallow the error).
 */

import type { Transaction } from "@agenticmind/shared/database/client"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { askTelemetry } from "@agenticmind/shared/database/schema"
import { ResultAsync } from "neverthrow"

export type AskTelemetryEvent = {
  memberId?: string | null
  questionHash: string
  /** Cache | card_synth | synth (enforced by the table check constraint). */
  servedBy: string
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
          servedBy: props.event.servedBy,
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

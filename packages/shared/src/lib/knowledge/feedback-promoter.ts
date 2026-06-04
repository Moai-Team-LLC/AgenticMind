/**
 * Feedback promoter. Walks ready clusters, asks an LLM-judge whether the
 * cluster's best answer is grounded in its citations, and on a `supported` verdict
 * writes a knowledge_cards row of kind=resolution (embedded, so it joins the
 * same hybrid retrieval pool). Two safeguards beyond user signals: the
 * factuality judge gate, and sticky terminal cluster states (no re-promotion).
 *
 * Pure helpers (parseJudgeResponse / judgeAllowsPromotion / confidenceForScore
 * / truncate) are unit-tested; the sweep is DB + LLM coupled (tsc-checked).
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { LlmModel } from "@agenticmind/shared/lib/ai/model"
import type { JudgeCitation, JudgeResult } from "@agenticmind/shared/lib/knowledge/feedback-judge"

import {
  listReadyClusters,
  markClusterPromoted,
  setClusterJudgeVerdict,
} from "@agenticmind/shared/database/query/knowledge/ask-clusters"
import {
  answerCache,
  askClusterMembers,
  askFeedback,
  askTelemetry,
  knowledgeCards,
  materials,
} from "@agenticmind/shared/database/schema"
import {
  buildJudgeUser,
  confidenceForScore,
  judgeAllowsPromotion,
  JUDGE_SYSTEM,
  parseJudgeResponse,
  truncate,
} from "@agenticmind/shared/lib/knowledge/feedback-judge"
import {
  completeKnowledge,
  embedKnowledgeText,
  KNOWLEDGE_EMBEDDING_MODEL,
} from "@agenticmind/shared/lib/knowledge/llm"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type PromoterError = { readonly type: "promoter_error"; readonly message: string }
const promoterError = (message: string): PromoterError => {
  return { type: "promoter_error", message }
}

const SENTINEL_MATERIAL_TITLE = "[resolutions]"

type BestAnswer = { answer: string; citations: JudgeCitation[] }

/** Top-scoring ask in a cluster + its cached answer/citations, or null. */
const fetchBestAnswer = async (tx: Transaction, clusterId: string): Promise<BestAnswer | null> => {
  const strengthSum = sql<number>`coalesce(sum(${askFeedback.strength}), 0)`
  const [top] = await tx
    .select({ askId: askClusterMembers.askId })
    .from(askClusterMembers)
    .leftJoin(askFeedback, eq(askFeedback.askId, askClusterMembers.askId))
    .where(eq(askClusterMembers.clusterId, clusterId))
    .groupBy(askClusterMembers.askId)
    .orderBy(desc(strengthSum))
    .limit(1)
  if (top === undefined) {
    return null
  }

  const [ans] = await tx
    .select({ answerText: answerCache.answerText, citationsJson: answerCache.citationsJson })
    .from(askTelemetry)
    .leftJoin(
      answerCache,
      and(
        eq(answerCache.questionHash, askTelemetry.questionHash),
        isNull(answerCache.invalidatedAt),
      ),
    )
    .where(eq(askTelemetry.id, top.askId))
    .limit(1)
  if (ans?.answerText === undefined || ans.answerText === null) {
    return null
  }

  const rawCitations = (ans.citationsJson as { title?: string; snippet?: string }[] | null) ?? []
  const citations: JudgeCitation[] = rawCitations.map((c) => {
    return {
      title: c.title ?? "",
      snippet: c.snippet ?? "",
    }
  })
  return { answer: ans.answerText, citations }
}

/** Find-or-create the synthetic material that resolution cards FK to. */
const ensureSentinelMaterial = async (tx: Transaction): Promise<string> => {
  const [found] = await tx
    .select({ id: materials.id })
    .from(materials)
    .where(eq(materials.title, SENTINEL_MATERIAL_TITLE))
    .limit(1)
  if (found !== undefined) {
    return found.id
  }
  const [created] = await tx
    .insert(materials)
    .values({ title: SENTINEL_MATERIAL_TITLE, source: "manual", status: "embedded" })
    .returning({ id: materials.id })
  return created?.id ?? ""
}

/** Default judge: calls the chat model + parses the verdict. */
const defaultJudge =
  (chatModel?: LlmModel) =>
  async (question: string, answer: string, citations: JudgeCitation[]): Promise<JudgeResult> => {
    const completion = await completeKnowledge({
      system: JUDGE_SYSTEM,
      user: buildJudgeUser(question, answer, citations),
      model: chatModel,
      purpose: "feedback judge",
    })
    if (completion.isErr()) {
      return { verdict: "unknown", rationale: `judge transport error: ${completion.error.message}` }
    }
    return parseJudgeResponse(completion.value)
  }

export type PromoteResult = { promoted: number; judged: number; skipped: number }

export type JudgeFn = (
  question: string,
  answer: string,
  citations: JudgeCitation[],
) => Promise<JudgeResult>

/**
 * One promotion pass over ready clusters. Per-cluster failures are logged +
 * skipped — one flaky judge call shouldn't lose the rest of the sweep.
 */
export const sweepPromoteClusters = (props: {
  tx: Transaction
  chatModel?: LlmModel
  maxPerSweep?: number
  judge?: JudgeFn
}): ResultAsync<PromoteResult, PromoterError> => {
  const maxPerSweep =
    props.maxPerSweep !== undefined && props.maxPerSweep > 0 && props.maxPerSweep <= 50
      ? props.maxPerSweep
      : 10
  const judge = props.judge ?? defaultJudge(props.chatModel)

  return ResultAsync.fromPromise(
    (async (): Promise<PromoteResult> => {
      const readyResult = await listReadyClusters({ tx: props.tx, limit: maxPerSweep })
      if (readyResult.isErr()) {
        throw new Error(readyResult.error.message)
      }
      const ready = readyResult.value

      let promoted = 0
      let judged = 0
      let skipped = 0

      for (const cluster of ready) {
        const best = await fetchBestAnswer(props.tx, cluster.id)
        if (best === null) {
          skipped++
          continue
        }

        const { verdict, rationale } = await judge(
          cluster.representativeQ,
          best.answer,
          best.citations,
        )
        await setClusterJudgeVerdict({
          tx: props.tx,
          clusterId: cluster.id,
          verdict,
          rationale,
        })
        judged++

        if (!judgeAllowsPromotion(verdict)) {
          continue
        }

        // Embed the answer (best-effort) so the card lands in vector retrieval.
        const embedded = await embedKnowledgeText(best.answer, "resolution card embed")
        const embedding = embedded.isOk() ? embedded.value : null

        const materialId = await ensureSentinelMaterial(props.tx)
        if (materialId === "") {
          skipped++
          continue
        }

        const [card] = await props.tx
          .insert(knowledgeCards)
          .values({
            materialId,
            kind: "resolution",
            subjectType: "Resolution",
            subjectValue: truncate(cluster.representativeQ, 200),
            body: best.answer,
            question: cluster.representativeQ,
            confidence: confidenceForScore(cluster.aggregateScore),
            embedding,
            embeddingModel: embedding !== null ? KNOWLEDGE_EMBEDDING_MODEL : null,
            extractorVersion: "resolution-v1",
            ftsConfig: "simple",
            bodyTsv: sql`to_tsvector('simple'::regconfig, coalesce(${best.answer}, ''))`,
          })
          .returning({ id: knowledgeCards.id })
        if (card === undefined) {
          skipped++
          continue
        }

        await markClusterPromoted({ tx: props.tx, clusterId: cluster.id, cardId: card.id })
        promoted++
      }

      return { promoted, judged, skipped }
    })(),
    (e) => promoterError(e instanceof Error ? e.message : String(e)),
  )
}

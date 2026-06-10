/**
 * Full-pipeline entrenchment eval — exercises BOTH ends of the compounding loop
 * against a live Postgres + a real LLM judge:
 *
 *   PROMOTE (judge in):  seed a fast-track cluster (3 all-positive signals) whose
 *     top ask has a grounded cached answer → run the promoter → the LLM judge
 *     rules `supported` → a `resolution` card is created and is retrievable.
 *   DEMOTE (brake out):  inject negative feedback until the cluster's aggregate
 *     score goes below the demotion floor → run the demotion sweep → the card is
 *     retracted to `deprecated`.
 *
 * Unlike `entrenchment-eval.ts` (which seeds the promoted state directly to
 * isolate the brake, no LLM), this one proves the *whole* lifecycle including the
 * judge gate. It therefore needs CHAT (judge) + EMBED (the promoter embeds the
 * promoted answer) — same env as `bun run eval`. Self-cleaning.
 *
 *   dotenvx run -f .env.local -- bun scripts/entrenchment-eval-full.ts
 */

import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { createClient } from "@agenticmind/shared/database/client"
import {
  addClusterMember,
  createCluster,
  recomputeClusterAggregates,
} from "@agenticmind/shared/database/query/knowledge/ask-clusters"
import { recordEvent } from "@agenticmind/shared/database/query/knowledge/ask-feedback"
import { recordAskTelemetry } from "@agenticmind/shared/database/query/knowledge/ask-telemetry"
import {
  answerCache,
  askClusters,
  askFeedback,
  askTelemetry,
  knowledgeCards,
  materials,
} from "@agenticmind/shared/database/schema"
import { sweepDemoteCards } from "@agenticmind/shared/lib/knowledge/demoter"
import { sweepPromoteClusters } from "@agenticmind/shared/lib/knowledge/feedback-promoter"
import { toVectorLiteral } from "@agenticmind/shared/lib/knowledge/vector"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { eq, inArray, sql } from "drizzle-orm"
import type { ResultAsync } from "neverthrow"

const MARKER = "[entrenchment-eval-full]"
const db = createClient(databaseSettings.DATABASE_URL)

const unwrap = async <T, E>(rA: ResultAsync<T, E>): Promise<T> => {
  const r = await rA
  if (r.isErr()) {
    throw new Error(`db step failed: ${JSON.stringify(r.error)}`)
  }
  return r.value
}

// A claim quoted verbatim from its citation snippet, so the grounded-ness judge
// reliably rules `supported` (the promotion gate).
const question = `${MARKER} how many reviewer approvals does a production deploy need?`
const answer = "A production deploy requires exactly two reviewer approvals before it can ship."
const citations = [
  {
    title: "Deploy policy",
    snippet:
      "Deploy policy: a production deploy requires exactly two reviewer approvals before it can ship.",
  },
]
const questionHash = "entrenchment-full-shared-hash"

let clusterId = ""
let promotedCardId: string | null = null
const askIds: string[] = []
let promoted = false
let demoted = false
const lines: string[] = []

const seedAsk = async (hash: string): Promise<string> => {
  const ask = await unwrap(
    recordAskTelemetry({
      tx: db,
      event: {
        questionHash: hash,
        servedBy: "synth",
        retrievalMs: 1,
        generationMs: 1,
        model: MARKER,
        citationCount: citations.length,
        answerChars: answer.length,
      },
    }),
  )
  askIds.push(ask.id)
  return ask.id
}

try {
  const centroid = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)
  clusterId = await unwrap(createCluster({ tx: db, representativeQ: question, centroid }))

  // The promoter reads the top ask's grounded answer from answer_cache (joined by
  // question_hash). Seed it once; all positive asks share the hash.
  await db.execute(sql`
    INSERT INTO answer_cache (
      question_hash, question_text, question_embedding, answer_text,
      citations_json, source_fingerprint, answer_model
    ) VALUES (
      ${questionHash}, ${question}, ${toVectorLiteral(centroid)}::vector, ${answer},
      ${JSON.stringify(citations)}::jsonb, ${MARKER}, ${MARKER}
    )
  `)

  // PROMOTE: 3 all-positive members, zero negatives → fast-track to `ready`.
  for (let i = 0; i < 3; i++) {
    const askId = await seedAsk(questionHash)
    await unwrap(addClusterMember({ tx: db, clusterId, askId, similarity: 0.97 }))
    await unwrap(
      recordEvent({
        tx: db,
        event: { askId, signal: "thumb_up", strength: 1, source: MARKER },
      }),
    )
  }
  await unwrap(recomputeClusterAggregates({ tx: db, clusterId }))

  const promoteResult = await unwrap(sweepPromoteClusters({ tx: db, maxPerSweep: 5 }))
  const [afterPromote] = await db
    .select({ state: askClusters.state, promotedCardId: askClusters.promotedCardId })
    .from(askClusters)
    .where(eq(askClusters.id, clusterId))
  promotedCardId = afterPromote?.promotedCardId ?? null
  let cardStatusAfterPromote = "—"
  if (promotedCardId !== null) {
    const [card] = await db
      .select({ status: knowledgeCards.status })
      .from(knowledgeCards)
      .where(eq(knowledgeCards.id, promotedCardId))
    cardStatusAfterPromote = card?.status ?? "—"
  }
  lines.push(
    `promote: judged=${promoteResult.judged} promoted=${promoteResult.promoted} ` +
      `→ cluster=${afterPromote?.state} card=${promotedCardId === null ? "none" : promotedCardId.slice(0, 8)} ` +
      `status=${cardStatusAfterPromote}`,
  )
  promoted =
    afterPromote?.state === "promoted" &&
    promotedCardId !== null &&
    cardStatusAfterPromote === "approved"

  // DEMOTE: the community turns. Inject negatives until the score crosses the floor.
  if (promoted) {
    for (let i = 0; i < 6; i++) {
      const askId = await seedAsk(`entrenchment-full-neg-${i}`)
      await unwrap(addClusterMember({ tx: db, clusterId, askId, similarity: 0.96 }))
      await unwrap(
        recordEvent({
          tx: db,
          event: { askId, signal: "thumb_down", strength: -1, source: MARKER },
        }),
      )
    }
    await unwrap(recomputeClusterAggregates({ tx: db, clusterId }))
    const [scored] = await db
      .select({ aggregateScore: askClusters.aggregateScore, feedbackCount: askClusters.feedbackCount })
      .from(askClusters)
      .where(eq(askClusters.id, clusterId))

    const demoteResult = await unwrap(sweepDemoteCards({ tx: db }))
    const [afterDemote] = await db
      .select({ status: knowledgeCards.status })
      .from(knowledgeCards)
      .where(eq(knowledgeCards.id, promotedCardId ?? ""))
    lines.push(
      `turn negative: score=${scored?.aggregateScore?.toFixed(2)} feedback=${scored?.feedbackCount}`,
    )
    lines.push(
      `demote: scanned=${demoteResult.scanned} demoted=${demoteResult.demoted} → card status=${afterDemote?.status}`,
    )
    demoted = afterDemote?.status === "deprecated"
  }
} finally {
  if (askIds.length > 0) {
    await db.delete(askFeedback).where(inArray(askFeedback.askId, askIds))
  }
  if (clusterId !== "") {
    await db.delete(askClusters).where(eq(askClusters.id, clusterId))
  }
  if (askIds.length > 0) {
    await db.delete(askTelemetry).where(inArray(askTelemetry.id, askIds))
  }
  await db.delete(answerCache).where(eq(answerCache.questionHash, questionHash))
  // The promoter created its sentinel `[resolutions]` material + the card; remove both.
  if (promotedCardId !== null) {
    await db.delete(knowledgeCards).where(eq(knowledgeCards.id, promotedCardId))
  }
  await db.delete(materials).where(eq(materials.title, "[resolutions]"))
}

const passed = promoted && demoted
console.log(`\nfull-pipeline entrenchment eval (promote → demote)\n${"-".repeat(50)}`)
for (const line of lines) {
  console.log(`  ${line}`)
}
console.log(
  `\n${passed ? "PASS" : "FAIL"}: an answer was promoted through the LLM judge, then ${
    passed ? "retracted once the community turned against it" : "NOT correctly retracted"
  }.`,
)
process.exit(passed ? 0 : 1)

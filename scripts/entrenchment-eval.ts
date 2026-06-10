/**
 * Entrenchment eval (the demotion half) — proves the anti-entrenchment brake
 * end-to-end against a live Postgres, deterministically and WITHOUT an LLM.
 *
 * The expert review's open question was: once the compounding loop promotes a
 * popular answer into a card, can the system retract it when the community later
 * turns against it? This eval answers it by construction:
 *
 *   1. seed a `promoted` cluster whose resolution card is live (`approved`),
 *   2. inject enough NEGATIVE feedback to drive the cluster's aggregate score
 *      below the demotion floor,
 *   3. recompute the aggregate (the same SQL the nightly sweep relies on),
 *   4. run `sweepDemoteCards`, and
 *   5. assert the card is now `deprecated` (non-retrievable).
 *
 * It needs only DATABASE_URL — no CHAT_API_KEY, because demotion is feedback-
 * driven, not LLM-driven (the promotion half is judge-gated and covered by unit
 * tests). The whole run is wrapped so its seed rows are DELETED at the end:
 * the eval mutates nothing permanently, pass or fail.
 *
 *   dotenvx run -f .env.local -- bun scripts/entrenchment-eval.ts
 *
 * Env: ENTRENCHMENT_NEGATIVES (default 6) — how many thumb_down events to seed.
 */

import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { createClient } from "@agenticmind/shared/database/client"
import {
  addClusterMember,
  createCluster,
  markClusterPromoted,
  recomputeClusterAggregates,
} from "@agenticmind/shared/database/query/knowledge/ask-clusters"
import { recordEvent } from "@agenticmind/shared/database/query/knowledge/ask-feedback"
import { recordAskTelemetry } from "@agenticmind/shared/database/query/knowledge/ask-telemetry"
import {
  askClusters,
  askFeedback,
  askTelemetry,
  knowledgeCards,
  materials,
} from "@agenticmind/shared/database/schema"
import {
  DEMOTION_MIN_FEEDBACK,
  DEMOTION_SCORE_THRESHOLD,
} from "@agenticmind/shared/lib/knowledge/clustering"
import { sweepDemoteCards } from "@agenticmind/shared/lib/knowledge/demoter"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { eq, inArray, sql } from "drizzle-orm"
import type { ResultAsync } from "neverthrow"

const MARKER = "[entrenchment-eval]"
const negatives = Math.max(
  DEMOTION_MIN_FEEDBACK,
  Number.parseInt(process.env.ENTRENCHMENT_NEGATIVES ?? "", 10) || 6,
)

const db = createClient(databaseSettings.DATABASE_URL)

/** Awaits a repository call and throws on error — keeps the happy path linear. */
const unwrap = async <T, E>(rA: ResultAsync<T, E>): Promise<T> => {
  const r = await rA
  if (r.isErr()) {
    throw new Error(`db step failed: ${JSON.stringify(r.error)}`)
  }
  return r.value
}

const question = `${MARKER} what is the recommended retry policy?`
const answer = `${MARKER} retry three times with exponential backoff.`

let materialId = ""
let cardId = ""
let clusterId = ""
const askIds: string[] = []
let passed = false
const lines: string[] = []

try {
  // 1. A sentinel material + a live (approved) resolution card — the artefact a
  //    promotion would have produced.
  const [material] = await db
    .insert(materials)
    .values({ title: MARKER, source: "manual", status: "embedded" })
    .returning({ id: materials.id })
  materialId = material?.id ?? ""

  const [card] = await db
    .insert(knowledgeCards)
    .values({
      materialId,
      kind: "resolution",
      subjectType: "Resolution",
      subjectValue: question.slice(0, 200),
      body: answer,
      question,
      confidence: 0.9,
      ftsConfig: "simple",
      bodyTsv: sql`to_tsvector('simple'::regconfig, ${answer})`,
    })
    .returning({ id: knowledgeCards.id, status: knowledgeCards.status })
  cardId = card?.id ?? ""
  lines.push(`seeded card ${cardId.slice(0, 8)} status=${card?.status} (retrievable)`)

  // 2. A cluster, flipped to the sticky `promoted` state and pointed at the card.
  const centroid = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)
  clusterId = await unwrap(createCluster({ tx: db, representativeQ: question, centroid }))
  await unwrap(markClusterPromoted({ tx: db, clusterId, cardId }))

  // 3. Inject negative feedback: each thumb_down (strength −1) is its own ask in
  //    the cluster, so the aggregate sum(strength)/sqrt(n) goes clearly negative.
  for (let i = 0; i < negatives; i++) {
    const ask = await unwrap(
      recordAskTelemetry({
        tx: db,
        event: {
          questionHash: `entrenchment-${i}`,
          servedBy: "synth",
          retrievalMs: 1,
          generationMs: 1,
          model: MARKER,
          citationCount: 1,
          answerChars: answer.length,
        },
      }),
    )
    askIds.push(ask.id)
    await unwrap(addClusterMember({ tx: db, clusterId, askId: ask.id, similarity: 0.95 }))
    await unwrap(
      recordEvent({
        tx: db,
        event: { askId: ask.id, signal: "thumb_down", strength: -1, source: MARKER },
      }),
    )
  }

  // 4. Recompute the aggregate exactly as the nightly sweep does.
  await unwrap(recomputeClusterAggregates({ tx: db, clusterId }))
  const [cluster] = await db
    .select({
      state: askClusters.state,
      aggregateScore: askClusters.aggregateScore,
      feedbackCount: askClusters.feedbackCount,
    })
    .from(askClusters)
    .where(eq(askClusters.id, clusterId))
  lines.push(
    `cluster state=${cluster?.state} score=${cluster?.aggregateScore?.toFixed(2)} ` +
      `feedback=${cluster?.feedbackCount} (floor ${DEMOTION_SCORE_THRESHOLD}, min ${DEMOTION_MIN_FEEDBACK})`,
  )
  const setupOk =
    cluster?.state === "promoted" &&
    (cluster?.aggregateScore ?? 0) <= DEMOTION_SCORE_THRESHOLD &&
    (cluster?.feedbackCount ?? 0) >= DEMOTION_MIN_FEEDBACK

  // 5. Run the brake and assert the card was retracted.
  const result = await unwrap(sweepDemoteCards({ tx: db }))
  const [after] = await db
    .select({ status: knowledgeCards.status, reason: knowledgeCards.confidenceReason })
    .from(knowledgeCards)
    .where(eq(knowledgeCards.id, cardId))
  lines.push(`sweep: scanned=${result.scanned} demoted=${result.demoted} skipped=${result.skipped}`)
  lines.push(`card after: status=${after?.status} reason=${after?.reason ?? "—"}`)

  passed = setupOk && after?.status === "deprecated"
} finally {
  // Non-destructive: remove every seed row (FK-safe order; cascades handle the rest).
  if (askIds.length > 0) {
    await db.delete(askFeedback).where(inArray(askFeedback.askId, askIds))
  }
  if (clusterId !== "") {
    await db.delete(askClusters).where(eq(askClusters.id, clusterId)) // cascades members
  }
  if (askIds.length > 0) {
    await db.delete(askTelemetry).where(inArray(askTelemetry.id, askIds))
  }
  if (materialId !== "") {
    await db.delete(materials).where(eq(materials.id, materialId)) // cascades the card
  }
}

console.log(`\nentrenchment eval — demotion half\n${"-".repeat(40)}`)
for (const line of lines) {
  console.log(`  ${line}`)
}
console.log(`\n${passed ? "PASS" : "FAIL"}: a promoted card whose cluster turned net-negative was ${
  passed ? "demoted to deprecated (retracted)" : "NOT retracted"
}.`)
process.exit(passed ? 0 : 1)

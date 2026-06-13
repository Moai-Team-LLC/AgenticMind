/**
 * Layer verification runner — the "enabled-but-dead" smoke check (Component #2),
 * driven by the manifest in lib/eval/layers.ts. For each answer-observable layer
 * it FORCE-enables that layer, runs a probe designed to trigger it, and asserts
 * the manifest's `firedFromAnswer` predicate holds. This is the regression the
 * answer-cache (0% hit) and GraphRAG (0 graph rows) outages would have tripped.
 *
 *   dotenvx run -f .env.local -- bun scripts/verify-layers.ts
 *
 * Needs DATABASE_URL + CHAT_API_KEY (+ RERANK_API_KEY to include the reranker).
 * Seeds its own small corpus (planted conflict + facts + filler for the pool).
 * Non-destructive only in the sense that it truncates + reseeds the eval corpus.
 */

import type { AnswerSignals } from "@agenticmind/shared/lib/eval/diagnose"
import type { Answer } from "@agenticmind/shared/lib/knowledge/synth"

import { createClient } from "@agenticmind/shared/database/client"
import { KNOWLEDGE_LAYERS } from "@agenticmind/shared/lib/eval/layers"
import { ask } from "@agenticmind/shared/lib/knowledge/ask"
import { nopBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import { ingestText } from "@agenticmind/shared/lib/knowledge/ingest"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { sql } from "drizzle-orm"

const db = createClient(databaseSettings.DATABASE_URL)
const layer = (id: string) => {
  const l = KNOWLEDGE_LAYERS.find((x) => x.id === id)
  if (l === undefined || l.firedFromAnswer === null) {
    throw new Error(`layer ${id} has no answer predicate`)
  }
  return l
}

const RATE_Q = "What is the current API rate limit for the service?"
const REFUND_Q = "What is the refund window?"

const seed = async () => {
  await db.execute(sql`TRUNCATE materials CASCADE`)
  await db.execute(sql`TRUNCATE ask_telemetry CASCADE`)
  await db.execute(sql`TRUNCATE answer_cache CASCADE`)
  const docs: { title: string; text: string }[] = [
    { title: "API rate limit", text: "The current API rate limit for the service is 1000 requests per minute per token." },
    { title: "Refund window — signed policy", text: "Per the signed policy, the refund window is 30 days from purchase." },
    { title: "Refund window — support note", text: "A support agent noted the refund window is 14 days in practice." },
  ]
  // Filler so the retrieval pool exceeds topK (needed for the reranker to engage).
  for (let i = 0; i < 12; i++) {
    docs.push({
      title: `Service note ${i + 1}`,
      text: `Service note ${i + 1}: the service covers onboarding, limits, billing, and support policy in general operational terms for section ${i + 1}.`,
    })
  }
  for (const d of docs) {
    await ingestText({ tx: db, blobStore: nopBlobStore, title: d.title, text: d.text, cardsEnabled: true })
  }
}

const signalsOf = (a: Answer): AnswerSignals => {
  return {
    status: a.status,
    servedBy: a.servedBy,
    groundedness: a.groundedness,
    semanticGroundedness: a.semanticGroundedness,
    abstained: a.abstained,
    citationsCount: a.citations.length,
    contestedCount: a.contested?.length ?? 0,
    rerankUsed: a.rerankUsed,
  }
}

type Result = { id: string; pass: boolean; detail: string; skipped?: boolean }

const run = async (): Promise<Result[]> => {
  const out: Result[] = []

  // answer_cache — same question twice; the second must be served from cache.
  {
    const l = layer("answer_cache")
    await ask({ tx: db, question: RATE_Q, cardsEnabled: false, cacheEnabled: true })
    const r2 = await ask({ tx: db, question: RATE_Q, cardsEnabled: false, cacheEnabled: true })
    const s = r2.isOk() ? signalsOf(r2.value) : {}
    out.push({ id: l.id, pass: l.firedFromAnswer?.(s) === true, detail: `servedBy=${s.servedBy}` })
  }

  // knowledge_cards — a fact query should be driven by a distilled card.
  {
    const l = layer("knowledge_cards")
    const r = await ask({ tx: db, question: RATE_Q, cardsEnabled: true, cacheEnabled: false })
    const s = r.isOk() ? signalsOf(r.value) : {}
    out.push({ id: l.id, pass: l.firedFromAnswer?.(s) === true, detail: `servedBy=${s.servedBy}` })
  }

  // contested_sources — the planted conflict must surface both sides.
  {
    const l = layer("contested_sources")
    const r = await ask({ tx: db, question: REFUND_Q, cardsEnabled: false, cacheEnabled: false, contestedSources: true })
    const s = r.isOk() ? signalsOf(r.value) : {}
    out.push({ id: l.id, pass: l.firedFromAnswer?.(s) === true, detail: `contested=${s.contestedCount} status=${s.status}` })
  }

  // faithfulness_tier_b — the semantic judge must populate semanticGroundedness.
  {
    const l = layer("faithfulness_tier_b")
    const r = await ask({ tx: db, question: RATE_Q, cardsEnabled: false, cacheEnabled: false, faithfulnessTierB: true })
    const s = r.isOk() ? signalsOf(r.value) : {}
    out.push({ id: l.id, pass: l.firedFromAnswer?.(s) === true, detail: `semanticGroundedness=${s.semanticGroundedness}` })
  }

  // reranker — env-gated (RERANK_ENABLED read at load); engages when pool > topK.
  {
    const l = layer("reranker")
    if (process.env.RERANK_ENABLED !== "true") {
      out.push({ id: l.id, pass: false, skipped: true, detail: "RERANK_ENABLED!=true — set it + RERANK_API_KEY to include" })
    } else {
      const r = await ask({ tx: db, question: RATE_Q, cardsEnabled: false, cacheEnabled: false })
      const s = r.isOk() ? signalsOf(r.value) : {}
      out.push({ id: l.id, pass: l.firedFromAnswer?.(s) === true, detail: `rerankUsed=${s.rerankUsed}` })
    }
  }

  return out
}

await seed()
const results = await run()
console.log(`\nlayer smoke check — "if enabled, it must fire"\n${"=".repeat(56)}`)
for (const r of results) {
  const mark = r.skipped === true ? "•" : r.pass ? "✓" : "✗"
  console.log(`  ${mark} ${r.id.padEnd(22)} ${r.detail}`)
}
const failed = results.filter((r) => r.skipped !== true && !r.pass)
console.log(`\n${failed.length === 0 ? "OK — every checked layer fired" : `FAIL — ${failed.length} layer(s) enabled but did not fire: ${failed.map((r) => r.id).join(", ")}`}`)
process.exit(failed.length === 0 ? 0 : 1)

/**
 * Pipeline diagnostics CLI — "I got a bad answer, where do I fix it?".
 * Runs one question through the engine, prints the full why-trace (status,
 * servedBy, per-stage timings, groundedness, contested, citations + trust), and
 * auto-localises the fault with the pure `classifyAnswer` rules (OPERATIONS §6).
 *
 *   dotenvx run -f .env.local -- bun scripts/diagnose.ts "your question here"
 *
 * Flags mirror production: pass the same KNOWLEDGE_* env you run with so the trace
 * reflects the real pipeline. Needs DATABASE_URL + CHAT_API_KEY + a seeded corpus.
 */

import type { AnswerSignals } from "@agenticmind/shared/lib/eval/diagnose"

import { createClient } from "@agenticmind/shared/database/client"
import { classifyAnswer } from "@agenticmind/shared/lib/eval/diagnose"
import { ask } from "@agenticmind/shared/lib/knowledge/ask"
import { knowledgeFeatureSettings } from "@agenticmind/shared/settings/knowledge-feature-settings"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"

const question = process.argv.slice(2).join(" ").trim()
if (question === "") {
  console.error('usage: bun scripts/diagnose.ts "your question"')
  process.exit(2)
}

const db = createClient(databaseSettings.DATABASE_URL)
const result = await ask({
  tx: db,
  question,
  cardsEnabled: knowledgeFeatureSettings.KNOWLEDGE_CARDS_ENABLED === "true",
  cacheEnabled: knowledgeFeatureSettings.KNOWLEDGE_CACHE_ENABLED === "true",
  contestedSources: knowledgeFeatureSettings.KNOWLEDGE_CONTESTED_SOURCES === "true",
  faithfulnessTierB: knowledgeFeatureSettings.KNOWLEDGE_FAITHFULNESS_TIER_B === "true",
})

if (result.isErr()) {
  console.error(`ask failed (a hard error, not a bad answer): ${result.error.message}`)
  process.exit(1)
}
const a = result.value
const signals: AnswerSignals = {
  status: a.status,
  servedBy: a.servedBy,
  groundedness: a.groundedness,
  semanticGroundedness: a.semanticGroundedness,
  abstained: a.abstained,
  citationsCount: a.citations.length,
  contestedCount: a.contested?.length ?? 0,
  contradictedClaims: a.contradictedClaims?.length ?? 0,
  unsupportedClaims: a.unsupportedClaims?.length ?? 0,
  staleSourcesOnly: a.staleSourcesOnly,
  rerankUsed: a.rerankUsed,
  phases: a.phases,
}

console.log(`\nQ: ${question}\n${"=".repeat(64)}`)
console.log("WHY-TRACE")
console.log(`  status=${signals.status}  servedBy=${signals.servedBy}  groundedness=${signals.groundedness}`)
console.log(`  citations=${signals.citationsCount}  contested=${signals.contestedCount}  staleOnly=${signals.staleSourcesOnly}  rerankUsed=${signals.rerankUsed}`)
if (signals.semanticGroundedness !== undefined) {
  console.log(`  semanticGroundedness=${signals.semanticGroundedness}  contradictedClaims=${signals.contradictedClaims}`)
}
console.log(`  phases: ${(signals.phases ?? []).map((p) => `${p.phase}=${p.ms}ms`).join(" ")}`)
console.log(`  citations: ${a.citations.map((c) => c.title).join(" | ") || "(none)"}`)

console.log(`\nDIAGNOSIS (most actionable first)`)
const diagnoses = classifyAnswer(signals)
if (diagnoses.length === 0) {
  console.log("  (no anomaly the signals can localise)")
}
for (const d of diagnoses) {
  console.log(`  [${d.severity.toUpperCase()}] ${d.stage}`)
  console.log(`      ${d.cause}`)
  console.log(`      → ${d.knob}`)
}
process.exit(0)

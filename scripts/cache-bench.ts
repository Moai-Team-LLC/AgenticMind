/**
 * Cache + cards benchmark — measures what the answer cache is actually FOR, which
 * the pass-rate ablation is blind to: the "dozens of agents asking the same
 * questions" workload. Three things the cache promises and this verifies:
 *
 *   1. CONSISTENCY — ask one question M times. With the cache OFF the engine
 *      re-synthesises each time (non-deterministic → answers drift); with it ON,
 *      calls after the first are byte-identical cache hits. We report the number
 *      of DISTINCT answers per question in each mode.
 *   2. HIT RATE / LLM CALLS AVOIDED — over an N-unique × M-repeat workload, how
 *      many calls are served from cache (`servedBy=cache`, no LLM) vs synthesised.
 *   3. LATENCY — a cache hit reports `generationMs = 0` (no model call); a synth
 *      call pays the LLM. We report the mean synthesis time a hit avoids.
 *
 * Plus a NEAR-DUP probe: a paraphrase of a cached question should still hit (the
 * cache matches on question-embedding cosine, not just exact hash).
 *
 * Needs DATABASE_URL + CHAT_API_KEY + EMBED + a seeded corpus. Non-destructive:
 * it truncates only answer_cache (its own working area), not the corpus.
 *
 *   CACHE_BENCH_REPEATS=4 dotenvx run -f .env.local -- bun scripts/cache-bench.ts
 */

import type { EvalCase } from "@agenticmind/shared/lib/eval/harness"

import { createClient } from "@agenticmind/shared/database/client"
import { ask } from "@agenticmind/shared/lib/knowledge/ask"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { sql } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const cases = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "eval", "cases.json"), "utf8"),
) as EvalCase[]

const db = createClient(databaseSettings.DATABASE_URL)
const M = Math.max(2, Number.parseInt(process.env.CACHE_BENCH_REPEATS ?? "", 10) || 4)

// Use real corpus-answerable questions so retrieval is non-trivial.
const questions = cases
  .filter((c) => c.failureMode === "factual_retrieval")
  .slice(0, 6)
  .map((c) => c.query)

type Obs = { answer: string; servedBy: string; genMs: number }

const askOnce = async (question: string, cacheEnabled: boolean): Promise<Obs | null> => {
  const r = await ask({ tx: db, question, cardsEnabled: true, cacheEnabled })
  if (r.isErr()) {
    return null
  }
  return { answer: r.value.answer, servedBy: r.value.servedBy, genMs: r.value.generationMs }
}

const truncateCache = () => db.execute(sql`TRUNCATE answer_cache`)
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

console.log(`cache + cards benchmark — ${questions.length} questions × ${M} repeats`)
console.log("=".repeat(64))

// ── Phase 1: consistency with cache OFF (expect drift) ───────────────────────
await truncateCache()
const distinctOff: number[] = []
const synthMs: number[] = []
for (const q of questions) {
  const answers: string[] = []
  for (let i = 0; i < M; i++) {
    const o = await askOnce(q, false)
    if (o !== null) {
      answers.push(o.answer.trim())
      synthMs.push(o.genMs)
    }
  }
  distinctOff.push(new Set(answers).size)
}

// ── Phase 2: consistency + hit rate with cache ON ────────────────────────────
await truncateCache()
const distinctOn: number[] = []
let hits = 0
let misses = 0
const cacheMs: number[] = []
for (const q of questions) {
  const answers: string[] = []
  for (let i = 0; i < M; i++) {
    const o = await askOnce(q, true)
    if (o === null) {
      continue
    }
    answers.push(o.answer.trim())
    if (o.servedBy === "cache") {
      hits++
      cacheMs.push(o.genMs)
    } else {
      misses++
    }
  }
  distinctOn.push(new Set(answers).size)
}

// ── Phase 3: near-duplicate probe (paraphrase should still hit) ──────────────
await truncateCache()
const original = "What is the current Project Zephyr API rate limit?"
const paraphrase = "How many requests does the Project Zephyr API currently permit?"
await askOnce(original, true) // warm
const para = await askOnce(paraphrase, true)

// ── Report ───────────────────────────────────────────────────────────────────
const total = hits + misses
const avgOff = mean(distinctOff)
const avgOn = mean(distinctOn)
console.log(`\nCONSISTENCY (distinct answers per question over ${M} asks; 1.0 = perfectly consistent)`)
console.log(`  cache OFF: ${avgOff.toFixed(2)} distinct/question  (re-synthesised → drifts)`)
console.log(`  cache ON : ${avgOn.toFixed(2)} distinct/question  (hits are byte-identical)`)

console.log(`\nHIT RATE / LLM CALLS AVOIDED (workload: ${questions.length} unique × ${M} = ${total} asks)`)
console.log(`  served from cache: ${hits}/${total} (${((hits / total) * 100).toFixed(0)}%)`)
console.log(
  `  LLM syntheses: ${misses} with cache vs ${total} without → ${(((total - misses) / total) * 100).toFixed(0)}% of LLM calls avoided`,
)

console.log(`\nLATENCY`)
console.log(`  synth call (LLM): mean generationMs ${mean(synthMs).toFixed(0)} ms`)
console.log(`  cache hit:        mean generationMs ${mean(cacheMs).toFixed(0)} ms (no model call)`)

console.log(`\nNEAR-DUPLICATE (paraphrase of a cached question)`)
console.log(`  "${paraphrase}"`)
console.log(
  `  servedBy = ${para?.servedBy ?? "error"} → ${para?.servedBy === "cache" ? "HIT (cosine match)" : "miss (fresh synth)"}`,
)
process.exit(0)

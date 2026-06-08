/**
 * Corpus-adaptive retrieval tuner (Lever 3.3). Runs the eval suite under a grid
 * of retrieval profiles (the knobs AskProps exposes — hybrid weights, recency,
 * topK, rerank pool) and keeps the profile that BEATS the active/default
 * baseline's pass rate WITHOUT regressing any failure mode (`selectBestParams`).
 * Eval-driven by construction, so it never ships a quiet regression.
 *
 * Closed read-path loop: the eval set is the curated corpus PLUS signal-derived
 * cases — real queries that earned net-positive agent feedback and were captured
 * under the opt-in eval-harvest flag (KNOWLEDGE_EVAL_HARVEST). So the tuner
 * adapts retrieval to THIS deployment's real traffic, not just a static set.
 *
 * Needs DATABASE_URL + CHAT_API_KEY + a seeded eval corpus (same as `bun run eval`).
 * No package.json entry is added here (that file is owned elsewhere); run directly:
 *
 *   dotenvx run -f .env.local -- tsx scripts/tune.ts            # report the winner (dry-run)
 *   dotenvx run -f .env.local -- tsx scripts/tune.ts --apply    # also write eval/retrieval-params.json
 *
 * The winner prints as a RETRIEVAL_PARAMS value — set it in the server's env to
 * activate the tuned profile (loaded once at boot, threaded into kl_ask_global).
 */

import type { AskForEval, EvalCase, EvalReport } from "@agenticmind/shared/lib/eval/harness"
import type {
  RetrievalParams,
  ScoredParams,
} from "@agenticmind/shared/lib/knowledge/retrieval-params"

import { createClient } from "@agenticmind/shared/database/client"
import { harvestSignalledQueries } from "@agenticmind/shared/database/query/knowledge/ask-telemetry"
import { runEvalSuite } from "@agenticmind/shared/lib/eval/harness"
import { ask } from "@agenticmind/shared/lib/knowledge/ask"
import { guardInput } from "@agenticmind/shared/lib/knowledge/guard"
import { selectBestParams } from "@agenticmind/shared/lib/knowledge/retrieval-params"
import { signalCasesFromHarvest } from "@agenticmind/shared/lib/knowledge/signal-eval-cases"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const curatedCases = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "eval", "cases.json"), "utf8"),
) as EvalCase[]

const db = createClient(databaseSettings.DATABASE_URL)

// Close the read-path loop: fold in real, agent-validated queries (captured under
// the opt-in eval-harvest flag) so the tuner optimises for THIS deployment's
// traffic, not just the curated corpus. Best-effort — empty when nothing was
// harvested, so the tuner still runs on the curated set alone.
const harvested = await harvestSignalledQueries({ tx: db })
const signalCases = harvested.isOk() ? signalCasesFromHarvest(harvested.value) : []
const cases: EvalCase[] = [...curatedCases, ...signalCases]
console.log(
  `eval set: ${curatedCases.length} curated + ${signalCases.length} signal-derived = ${cases.length} cases`,
)
const cardsEnabled = process.env.KNOWLEDGE_CARDS_ENABLED === "true"
const cacheEnabled = process.env.KNOWLEDGE_CACHE_ENABLED === "true"

/** An AskForEval that runs the engine under a given retrieval profile. */
const askWith =
  (params: RetrievalParams): AskForEval =>
  async (query) => {
    const guard = guardInput(query)
    if (!guard.ok) {
      return { blocked: true, answer: "", citations: [] }
    }
    const res = await ask({
      tx: db,
      question: query,
      cardsEnabled,
      cacheEnabled,
      hybridWeights: params.hybridWeights,
      recencyConfig: params.recencyConfig,
      topK: params.topK,
      rerankTopN: params.rerankTopN,
    })
    if (res.isErr()) {
      return { blocked: false, answer: "", citations: [] }
    }
    return {
      blocked: false,
      answer: res.value.answer,
      groundedness: res.value.groundedness,
      abstained: res.value.abstained,
      citations: res.value.citations.map((c) => {
        return { title: c.title, materialId: c.materialId }
      }),
    }
  }

const toScored = (params: RetrievalParams, report: EvalReport): ScoredParams => {
  return {
    params,
    passRate: report.passRate,
    byFailureMode: Object.fromEntries(
      Object.entries(report.byFailureMode).map(([mode, b]) => [mode, b.passRate]),
    ),
  }
}

const run = async (params: RetrievalParams): Promise<ScoredParams> =>
  toScored(params, await runEvalSuite(cases, askWith(params)))

/** The search grid over the injectable knobs. Keep small — each entry is a full eval pass. */
const CANDIDATES: RetrievalParams[] = [
  { hybridWeights: { vector: 0.8, bm25: 0.2 } },
  { hybridWeights: { vector: 0.6, bm25: 0.4 } },
  { topK: 6 },
  { topK: 12 },
  { rerankTopN: 6 },
  { hybridWeights: { vector: 0.75, bm25: 0.25 }, topK: 10 },
]

const active = await run({})
console.log(`active (defaults): ${(active.passRate * 100).toFixed(1)}%`)

const scored: ScoredParams[] = []
for (const candidate of CANDIDATES) {
  const s = await run(candidate)
  console.log(`candidate ${JSON.stringify(candidate)}: ${(s.passRate * 100).toFixed(1)}%`)
  scored.push(s)
}

const winner = selectBestParams(active, scored)
if (winner === null) {
  console.log("\nNo candidate beat the active profile without regressing a mode. Keeping defaults.")
  process.exit(0)
}

const delta = ((winner.passRate - active.passRate) * 100).toFixed(1)
console.log(`\nWinner (+${delta} pts): ${JSON.stringify(winner.params)}`)
console.log(`Activate with: RETRIEVAL_PARAMS='${JSON.stringify(winner.params)}'`)

if (process.argv.includes("--apply")) {
  const out = join(import.meta.dir, "..", "eval", "retrieval-params.json")
  writeFileSync(out, `${JSON.stringify(winner.params, null, 2)}\n`)
  console.log(`Wrote ${out}`)
}
process.exit(0)

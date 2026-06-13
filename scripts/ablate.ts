/**
 * Component ablation harness (Track B). Runs the eval suite under a matrix of
 * engine configurations — each toggling ONE component off — and prints a table
 * of pass rate + each component's contribution (baseline − without). So every
 * degree of freedom (knowledge cards, answer cache, contested-sources, Tier-B
 * faithfulness) is justified by data, not assumed: a component whose removal
 * drops the pass rate earns its complexity; a ~0 contribution is a candidate to
 * cut.
 *
 * Needs DATABASE_URL + CHAT_API_KEY + a seeded eval corpus (same as `bun run eval`).
 * No package.json entry (that file is owned elsewhere); run directly:
 *
 *   dotenvx run -f .env.local -- bun scripts/ablate.ts
 *
 * This toggles the AskProps-level components. Env-level ones
 * (RERANK_ENABLED) is ablated by running this twice
 * with the env flag flipped and comparing the two baselines.
 */

import type { AskForEval, EvalCase, JudgeForEval } from "@agenticmind/shared/lib/eval/harness"

import { createClient } from "@agenticmind/shared/database/client"
import { runEvalSuite } from "@agenticmind/shared/lib/eval/harness"
import { ask } from "@agenticmind/shared/lib/knowledge/ask"
import { guardInput } from "@agenticmind/shared/lib/knowledge/guard"
import { completeKnowledgeJson } from "@agenticmind/shared/lib/knowledge/llm"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as z from "zod"

const cases = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "eval", "cases.json"), "utf8"),
) as EvalCase[]

const db = createClient(databaseSettings.DATABASE_URL)

type AblationConfig = { cards: boolean; cache: boolean; contested: boolean; tierB: boolean }

/** An AskForEval that runs the engine under a given component configuration. */
const askWith =
  (cfg: AblationConfig): AskForEval =>
  async (query) => {
    const guard = guardInput(query)
    if (!guard.ok) {
      return { blocked: true, answer: "", citations: [] }
    }
    const res = await ask({
      tx: db,
      question: query,
      cardsEnabled: cfg.cards,
      cacheEnabled: cfg.cache,
      contestedSources: cfg.contested,
      faithfulnessTierB: cfg.tierB,
    })
    if (res.isErr()) {
      return { blocked: false, answer: "", citations: [] }
    }
    return {
      blocked: false,
      answer: res.value.answer,
      groundedness: res.value.groundedness,
      abstained: res.value.abstained,
      status: res.value.status,
      contestedCount: res.value.contested?.length ?? 0,
      staleSourcesOnly: res.value.staleSourcesOnly,
      servedBy: res.value.servedBy,
      citations: res.value.citations.map((c) => {
        return { title: c.title, materialId: c.materialId }
      }),
    }
  }

const judgeSchema = z.object({ verdict: z.boolean(), reason: z.string() })
const judge: JudgeForEval = async (question, observation) => {
  const res = await completeKnowledgeJson({
    system:
      "You are a strict evaluator. Answer the yes/no question about the ANSWER with a JSON " +
      '{ "verdict": <boolean>, "reason": "<one clause>" } — true means yes. Judge only what the answer states.',
    user: `Question: ${question}\n\nAnswer:\n${observation.answer}`,
    schema: judgeSchema,
    purpose: "ablation level-2 judge",
  })
  return res.isOk() ? res.value.verdict : false
}

const COMPONENTS = ["cards", "cache", "contested", "tierB"] as const
const BASELINE: AblationConfig = { cards: true, cache: true, contested: true, tierB: true }

const passRateOf = async (cfg: AblationConfig): Promise<number> => {
  const report = await runEvalSuite(cases, askWith(cfg), judge)
  return report.passRate
}

const basePass = await passRateOf(BASELINE)
console.log(
  `baseline (all components on): ${(basePass * 100).toFixed(1)}%  over ${cases.length} cases`,
)
console.log("\ncomponent      without    contribution")
for (const component of COMPONENTS) {
  const without = await passRateOf({ ...BASELINE, [component]: false })
  const contribution = (basePass - without) * 100
  const sign = contribution >= 0 ? "+" : ""
  console.log(
    `  ${component.padEnd(11)} ${(without * 100).toFixed(1).padStart(6)}%   ${sign}${contribution.toFixed(1)} pts`,
  )
}
console.log(
  "\nPositive contribution = removing the component lowered quality (it earns its complexity).",
)
console.log("~0 contribution = no measured effect on this corpus — a candidate to simplify away.")
process.exit(0)

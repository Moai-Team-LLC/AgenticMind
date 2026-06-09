/**
 * Integration eval runner — wires the harness (lib/eval) to the real engine
 * (guard + ask). Needs DATABASE_URL + CHAT_API_KEY. Exits non-zero when
 * the run regresses below the baseline pass rate (the CI gate).
 *
 *   bun run eval                 # uses BASELINE_PASS_RATE (default 0.8)
 */

import type { AskForEval, EvalCase, JudgeForEval } from "@agenticmind/shared/lib/eval/harness"

import { createClient } from "@agenticmind/shared/database/client"
import { isRegression, runEvalSuite } from "@agenticmind/shared/lib/eval/harness"
import { ask } from "@agenticmind/shared/lib/knowledge/ask"
import { guardInput } from "@agenticmind/shared/lib/knowledge/guard"
import { completeKnowledgeJson } from "@agenticmind/shared/lib/knowledge/llm"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as z from "zod"

const allCases = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "eval", "cases.json"), "utf8"),
) as EvalCase[]
// EVAL_ONLY=mode1,mode2 restricts the run to those failure modes (dev iteration).
const only = process.env.EVAL_ONLY?.split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
const cases =
  only !== undefined && only.length > 0
    ? allCases.filter((c) => only.includes(c.failureMode))
    : allCases

const db = createClient(databaseSettings.DATABASE_URL)
const cardsEnabled = process.env.KNOWLEDGE_CARDS_ENABLED === "true"
const cacheEnabled = process.env.KNOWLEDGE_CACHE_ENABLED === "true"

const askForEval: AskForEval = async (query) => {
  const guard = guardInput(query)
  if (!guard.ok) {
    return { blocked: true, answer: "", citations: [] }
  }
  // contestedSources on so the conflict/trust buckets get a populated `contested`.
  const res = await ask({
    tx: db,
    question: query,
    cardsEnabled,
    cacheEnabled,
    contestedSources: true,
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

// Level-2 binary judge: answers a case's `judge` yes/no question about the
// answer with a boolean (true = the answer satisfies it). On a judge error it
// returns false so a case never silently passes.
const judgeSchema = z.object({ verdict: z.boolean(), reason: z.string() })
const judge: JudgeForEval = async (question, observation) => {
  const res = await completeKnowledgeJson({
    system:
      "You are a strict evaluator. Answer the yes/no question about the ANSWER with a JSON " +
      '{ "verdict": <boolean>, "reason": "<one clause>" } — true means yes. Judge only what the answer states.',
    user: `Question: ${question}\n\nAnswer:\n${observation.answer}`,
    schema: judgeSchema,
    purpose: "eval level-2 judge",
  })
  return res.isOk() ? res.value.verdict : false
}

const baseline = Number(process.env.BASELINE_PASS_RATE ?? "0.8")

const report = await runEvalSuite(cases, askForEval, judge)

console.log(
  `\nEval: ${report.passed}/${report.total} passed (${(report.passRate * 100).toFixed(1)}%)`,
)
for (const [mode, b] of Object.entries(report.byFailureMode)) {
  console.log(`  ${mode}: ${b.passed}/${b.total} (${(b.passRate * 100).toFixed(0)}%)`)
}
if (report.citationPrecision !== undefined) {
  console.log(
    `  citation precision ${(report.citationPrecision * 100).toFixed(0)}% · recall ${((report.citationRecall ?? 0) * 100).toFixed(0)}%`,
  )
}
for (const r of report.results.filter((x) => !x.passed)) {
  console.log(`  ✗ ${r.id} [${r.failureMode}]: ${r.failures.join("; ")}`)
}

if (isRegression(report, baseline)) {
  console.error(
    `\nREGRESSION: pass rate ${(report.passRate * 100).toFixed(1)}% < baseline ${(baseline * 100).toFixed(0)}%`,
  )
  process.exit(1)
}
console.log("\nEval gate passed.")
process.exit(0)

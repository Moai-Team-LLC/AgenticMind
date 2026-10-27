/**
 * Integration eval runner — wires the harness (lib/eval) to the real engine
 * (guard + ask). Needs DATABASE_URL + CHAT_API_KEY. Exits 1 when the run
 * regresses below the baseline pass rate or a failure mode falls under its floor
 * (the CI gate), 2 when the gate's own settings are invalid (nothing was run).
 * Ends with the run's token usage per model.
 *
 *   bun run eval                 # uses BASELINE_PASS_RATE (default 0.8)
 *   BASELINE_MODE_FLOORS='{"faithfulness":0.8}' bun run eval   # + per-mode floors
 */

import type { AskForEval, EvalCase, JudgeForEval } from "@agenticmind/shared/lib/eval/harness"

import { createClient } from "@agenticmind/shared/database/client"
import {
  isRegression,
  modeFloorBreaches,
  parseBaselinePassRate,
  parseModeFloors,
  runEvalSuite,
} from "@agenticmind/shared/lib/eval/harness"
import { ask } from "@agenticmind/shared/lib/knowledge/ask"
import { guardInput } from "@agenticmind/shared/lib/knowledge/guard"
import { completeKnowledgeJson } from "@agenticmind/shared/lib/knowledge/llm"
import {
  formatLlmUsageReport,
  llmUsageSnapshot,
} from "@agenticmind/shared/lib/observability/llm-usage"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import * as z from "zod"

const allCases = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "eval", "cases.json"), "utf8"),
) as EvalCase[]
// EVAL_ONLY=mode1,mode2 restricts the run to those failure modes (dev iteration).
const only = process.env.EVAL_ONLY?.split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
const cases =
  only !== undefined && only.length > 0
    ? allCases.filter((c) => only.includes(c.failureMode))
    : allCases

// Gate settings are checked before the first model call: a typo must not cost a
// paid run, and must not quietly mean "no gate" either.
const baselineRes = parseBaselinePassRate(process.env.BASELINE_PASS_RATE)
const floorsRes = parseModeFloors(process.env.BASELINE_MODE_FLOORS, [
  ...new Set(allCases.map((c) => c.failureMode)),
])
if (baselineRes.isErr() || floorsRes.isErr()) {
  for (const r of [baselineRes, floorsRes]) {
    if (r.isErr()) {
      console.error(`eval gate NOT RUN — ${r.error}`)
    }
  }
  process.exit(2)
}
const baseline = baselineRes.value
const floors = floorsRes.value

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

// The run's token usage, printed last on every outcome (pass, regression, crash) so
// its cost is readable from the CI log; on GitHub Actions the total also lands in
// the job summary.
const printUsage = (): void => {
  const usageLines = formatLlmUsageReport(llmUsageSnapshot())
  console.log("\nToken usage (provider-reported, calls that returned):")
  for (const line of usageLines) {
    console.log(line)
  }
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary !== undefined && summary !== "") {
    appendFileSync(summary, `eval-gate ${usageLines.at(-1) ?? ""}\n\n`)
  }
}

let report: Awaited<ReturnType<typeof runEvalSuite>>
try {
  report = await runEvalSuite(cases, askForEval, judge)
} catch (error) {
  printUsage()
  throw error
}

console.log(
  `\nEval: ${report.passed}/${report.total} passed (${(report.passRate * 100).toFixed(1)}%)`,
)
for (const [mode, b] of Object.entries(report.byFailureMode)) {
  const floor = floors[mode]
  const floorNote = floor === undefined ? "" : ` · floor ${(floor * 100).toFixed(0)}%`
  console.log(`  ${mode}: ${b.passed}/${b.total} (${(b.passRate * 100).toFixed(0)}%)${floorNote}`)
}
if (report.citationPrecision !== undefined) {
  console.log(
    `  citation precision ${(report.citationPrecision * 100).toFixed(0)}% · recall ${((report.citationRecall ?? 0) * 100).toFixed(0)}%`,
  )
}
for (const r of report.results.filter((x) => !x.passed)) {
  console.log(`  ✗ ${r.id} [${r.failureMode}]: ${r.failures.join("; ")}`)
}

const regressed = isRegression(report, baseline, undefined, floors)
if (regressed) {
  if (isRegression(report, baseline)) {
    console.error(
      `\nREGRESSION: pass rate ${(report.passRate * 100).toFixed(1)}% < baseline ${(baseline * 100).toFixed(0)}%`,
    )
  }
  for (const b of modeFloorBreaches(report, floors)) {
    console.error(
      b.total === 0
        ? `\nREGRESSION: ${b.mode} has a floor of ${(b.floor * 100).toFixed(0)}% but no case of it ran`
        : `\nREGRESSION: ${b.mode} ${b.passed}/${b.total} (${(b.passRate * 100).toFixed(0)}%) < floor ${(b.floor * 100).toFixed(0)}%`,
    )
  }
} else {
  console.log("\nEval gate passed.")
}
printUsage()
process.exit(regressed ? 1 : 0)

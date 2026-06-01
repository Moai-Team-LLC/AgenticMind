/**
 * Integration eval runner — wires the harness (lib/eval) to the real engine
 * (guard + ask). Needs DATABASE_URL + OPENROUTER_API_KEY. Exits non-zero when
 * the run regresses below the baseline pass rate (the CI gate).
 *
 *   bun run eval                 # uses BASELINE_PASS_RATE (default 0.8)
 */

import type { AskForEval, EvalCase } from "@agenticmind/shared/lib/eval/harness"

import { createClient } from "@agenticmind/shared/database/client"
import { isRegression, runEvalSuite } from "@agenticmind/shared/lib/eval/harness"
import { ask } from "@agenticmind/shared/lib/knowledge/ask"
import { guardInput } from "@agenticmind/shared/lib/knowledge/guard"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const cases = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "eval", "cases.json"), "utf8"),
) as EvalCase[]

const db = createClient(databaseSettings.DATABASE_URL)
const cardsEnabled = process.env.KNOWLEDGE_CARDS_ENABLED === "true"
const cacheEnabled = process.env.KNOWLEDGE_CACHE_ENABLED === "true"

const askForEval: AskForEval = async (query) => {
  const guard = guardInput(query)
  if (!guard.ok) {
    return { blocked: true, answer: "", citations: [] }
  }
  const res = await ask({ tx: db, question: query, cardsEnabled, cacheEnabled })
  if (res.isErr()) {
    return { blocked: false, answer: "", citations: [] }
  }
  return {
    blocked: false,
    answer: res.value.answer,
    citations: res.value.citations.map((c) => {
      return { title: c.title, materialId: c.materialId }
    }),
  }
}

const baseline = Number(process.env.BASELINE_PASS_RATE ?? "0.8")

const report = await runEvalSuite(cases, askForEval)

console.log(
  `\nEval: ${report.passed}/${report.total} passed (${(report.passRate * 100).toFixed(1)}%)`,
)
for (const [mode, b] of Object.entries(report.byFailureMode)) {
  console.log(`  ${mode}: ${b.passed}/${b.total} (${(b.passRate * 100).toFixed(0)}%)`)
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

/**
 * Judge calibration runner — runs the feedback LLM-judge against the
 * human-labeled set (eval/judge-labels.json) and reports TPR/TNR. Exits
 * non-zero when the judge is not calibrated (both rates must clear 0.8).
 * Needs OPENROUTER_API_KEY. Run: bun run calibrate
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { calibrateJudge, type LabeledExample } from "@agenticmind/shared/lib/eval/judge-calibration"
import {
  JUDGE_SYSTEM,
  judgeAllowsPromotion,
  parseJudgeResponse,
} from "@agenticmind/shared/lib/knowledge/feedback-judge"
import { completeKnowledge } from "@agenticmind/shared/lib/knowledge/llm"

const labels = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "eval", "judge-labels.json"), "utf8"),
) as LabeledExample[]

const judge = async (ex: LabeledExample): Promise<boolean> => {
  const res = await completeKnowledge({
    system: JUDGE_SYSTEM,
    user: ex.input,
    model: "openai/gpt-5-mini",
    purpose: "judge calibration",
  })
  if (res.isErr()) return false
  return judgeAllowsPromotion(parseJudgeResponse(res.value).verdict)
}

const r = await calibrateJudge(labels, judge, 0.8)
console.log(
  `\nJudge calibration: TPR=${(r.tpr * 100).toFixed(0)}% TNR=${(r.tnr * 100).toFixed(0)}% ` +
    `acc=${(r.accuracy * 100).toFixed(0)}% calibrated=${r.calibrated}`,
)
console.log(`  confusion: tp=${r.tp} fp=${r.fp} tn=${r.tn} fn=${r.fn}`)
for (const m of r.misses) console.log(`  miss ${m.id}: expected=${m.expected} got=${m.got}`)
process.exit(r.calibrated ? 0 : 1)

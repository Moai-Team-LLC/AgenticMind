/**
 * Generator↔judge decorrelation (Verified-Autonomy doctrine §1a). A verify judge that
 * runs on the SAME model family as the answer generator shares its blind spots and
 * co-signs its hallucinations ("two GPT passes are one opinion twice"). This resolves a
 * judge model that is, when configured, a DIFFERENT family than the generator. Pure.
 */

import type { LlmModel } from "@agenticmind/shared/lib/ai/model"

/** Coarse provider family of a model id (possibly `provider/model`), for decorrelation. */
export const providerFamily = (model: string): string => {
  const m = model.toLowerCase()
  const slash = m.indexOf("/")
  const bare = slash > 0 ? m.slice(slash + 1) : m
  if (/^(gpt-|o1|o3|o4|chatgpt|text-)/u.test(bare) || m.includes("openai")) return "openai"
  if (bare.includes("claude") || m.includes("anthropic")) return "anthropic"
  if (bare.includes("gemini") || m.includes("google")) return "google"
  if (/llama|mistral|mixtral|qwen|deepseek|gemma/u.test(bare)) return "open-weights"
  return slash > 0 ? m.slice(0, slash) : "unknown"
}

export interface JudgeDecorrelation {
  decorrelated: boolean
  reason?: string
}

/** True only when judge and generator are different model families. */
export const checkJudgeGeneratorDecorrelation = (
  generatorModel: string,
  judgeModel: string,
): JudgeDecorrelation => {
  const gen = providerFamily(generatorModel)
  const judge = providerFamily(judgeModel)
  return gen === judge
    ? {
        decorrelated: false,
        reason: `judge (${judgeModel}) shares the generator's family "${judge}" — a same-family check co-signs shared blind spots`,
      }
    : { decorrelated: true }
}

/**
 * The model a verify JUDGE should run on. When a distinct `CHAT_JUDGE_MODEL` is
 * configured, use it (the operator points it at a different family — e.g. Gemini/Claude
 * via the Gateway). When it is absent, fall back to the generator model: a correlated,
 * degraded check — there is no second-family key to route to, so this is honest rather
 * than pretending to be independent.
 */
export const resolveJudgeModel = (generatorModel: LlmModel, configured?: string): LlmModel =>
  configured !== undefined && configured.length > 0 ? configured : generatorModel

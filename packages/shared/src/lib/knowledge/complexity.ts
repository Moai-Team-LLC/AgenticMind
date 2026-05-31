/**
 * Question complexity → adaptive model routing. Cheap heuristic (no LLM) that
 * sends simple fact-lookups to the fast/cheap model and multi-part / comparative
 * / long questions to the flagship. Keeps ~70% of queries on the cheap tier.
 * Pure + unit-tested.
 */

import type { LlmModel } from "@agenticmind/shared/lib/ai/model"

import { aiSettings } from "@agenticmind/shared/settings/ai-settings"

export type Complexity = "simple" | "complex"

const COMPARE = /(compare|versus|\bvs\b|difference|differ|trade-?offs?)/iu

/** True when the question looks like it needs synthesis across parts. */
export const classifyComplexity = (question: string): Complexity => {
  const q = question.trim()
  const words = q.split(/\s+/u).filter((w) => w !== "").length
  const questionMarks = (q.match(/\?/gu) ?? []).length
  const commas = (q.match(/,/gu) ?? []).length

  if (COMPARE.test(q)) {
    return "complex"
  }
  if (words > 25) {
    return "complex"
  }
  if (questionMarks >= 2) {
    return "complex"
  }
  if (words > 15 && commas >= 2) {
    return "complex"
  }
  return "simple"
}

// Tier defaults, also applied in code (not only via zod) so they survive
// SKIP_VALIDATION, which the repo's dev env sets.
const DEFAULT_SIMPLE_MODEL = "google/gemini-3.1-flash-lite-preview"
const DEFAULT_COMPLEX_MODEL = "openai/gpt-5-mini"

/** The model tier for a complexity class (configurable via CHAT_MODEL_*). */
export const modelForComplexity = (c: Complexity): LlmModel =>
  c === "complex"
    ? (aiSettings.CHAT_MODEL_COMPLEX ?? DEFAULT_COMPLEX_MODEL)
    : (aiSettings.CHAT_MODEL_SIMPLE ?? DEFAULT_SIMPLE_MODEL)

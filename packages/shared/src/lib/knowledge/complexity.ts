/**
 * Question complexity → adaptive model routing. Cheap heuristic (no LLM) that
 * sends simple fact-lookups to the fast/cheap model and multi-part / comparative
 * / long questions to the flagship. Keeps ~70% of queries on the cheap tier.
 * Pure + unit-tested.
 */

import type { LlmModel } from "@agenticmind/shared/lib/ai/model"

export type Complexity = "simple" | "complex"

const COMPARE = /(compare|versus|\bvs\b|difference|differ|trade-?offs?)/iu

/** True when the question looks like it needs synthesis across parts. */
export const classifyComplexity = (question: string): Complexity => {
  const q = question.trim()
  const words = q.split(/\s+/u).filter((w) => w !== "").length
  const questionMarks = (q.match(/\?/gu) ?? []).length
  const commas = (q.match(/,/gu) ?? []).length

  if (COMPARE.test(q)) return "complex"
  if (words > 25) return "complex"
  if (questionMarks >= 2) return "complex"
  if (words > 15 && commas >= 2) return "complex"
  return "simple"
}

const SIMPLE_MODEL: LlmModel = "google/gemini-3.1-flash-lite-preview"
const COMPLEX_MODEL: LlmModel = "openai/gpt-5-mini"

/** The model tier for a complexity class. */
export const modelForComplexity = (c: Complexity): LlmModel =>
  c === "complex" ? COMPLEX_MODEL : SIMPLE_MODEL

/**
 * Pure LLM-judge helpers for the feedback promoter — kept env-free (no llm /
 * db imports) so they unit-test in isolation. The promoter (feedback-
 * promoter.ts) wires these to the chat model + cluster repo. Ported from the
 * judge bits of services/knowledge/internal/feedback/promoter.go.
 */

export type JudgeCitation = { title: string; snippet: string }
export type JudgeVerdict = "supported" | "partially_supported" | "unsupported" | "unknown"
export type JudgeResult = { verdict: JudgeVerdict; rationale: string }

export const JUDGE_SYSTEM = `You are an auditor verifying whether an answer is grounded in the
provided source snippets.

Rules:
- The provided snippets are the ONLY valid grounding. Outside knowledge
  doesn't count as supported.
- Judge only factual support — not style or completeness.

Return ONLY a JSON object:
{ "verdict": "supported" | "partially_supported" | "unsupported" | "unknown",
  "rationale": "<one sentence>" }`

/** Builds the judge user turn from the (question, answer, citations) triple. */
export const buildJudgeUser = (
  question: string,
  answer: string,
  citations: JudgeCitation[],
): string => {
  const snippets =
    citations.length === 0
      ? "(no snippets — answer was uncited)"
      : citations.map((c, i) => `[${i + 1}] ${c.title}\n${c.snippet}\n`).join("\n")
  return `Question:\n${question.trim()}\n\nAnswer:\n${answer.trim()}\n\nSnippets:\n${snippets.trim()}`
}

/** Tolerant parse of the judge's JSON (handles code fences). */
export const parseJudgeResponse = (raw: string): JudgeResult => {
  let clean = raw.trim()
  if (clean.startsWith("```json")) clean = clean.slice("```json".length)
  else if (clean.startsWith("```")) clean = clean.slice(3)
  if (clean.endsWith("```")) clean = clean.slice(0, -3)
  clean = clean.trim()
  let obj: { verdict?: unknown; rationale?: unknown }
  try {
    obj = JSON.parse(clean) as { verdict?: unknown; rationale?: unknown }
  } catch {
    return { verdict: "unknown", rationale: "judge response not valid JSON" }
  }
  const verdict = obj.verdict
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : ""
  if (
    verdict === "supported" ||
    verdict === "partially_supported" ||
    verdict === "unsupported" ||
    verdict === "unknown"
  ) {
    return { verdict, rationale }
  }
  return {
    verdict: "unknown",
    rationale: `judge returned unrecognised verdict: ${String(verdict)}`,
  }
}

/** Promote on `supported` only — partial support risks canonicalising drift. */
export const judgeAllowsPromotion = (verdict: string): boolean => verdict === "supported"

/** Resolution-card confidence from the cluster's aggregate score. */
export const confidenceForScore = (aggregateScore: number): number =>
  aggregateScore > 1 ? 0.95 : aggregateScore > 0.85 ? 0.85 : 0.7

/** Rune-safe truncation to n characters. */
export const truncate = (s: string, n: number): string => {
  const runes = [...s]
  return runes.length <= n ? s : runes.slice(0, n).join("")
}

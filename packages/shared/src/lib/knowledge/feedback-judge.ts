/**
 * Pure LLM-judge helpers for the feedback promoter — kept env-free (no llm /
 * db imports) so they unit-test in isolation. The promoter (feedback-
 * promoter.ts) wires these to the chat model + cluster repo.
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
  if (clean.startsWith("```json")) {
    clean = clean.slice("```json".length)
  } else if (clean.startsWith("```")) {
    clean = clean.slice(3)
  }
  if (clean.endsWith("```")) {
    clean = clean.slice(0, -3)
  }
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
  const runes = Array.from(s)
  return runes.length <= n ? s : runes.slice(0, n).join("")
}

// ── Answer-time groundedness (faithfulness) judge ──────────────────────────
// Same verdict semantics as JUDGE_SYSTEM (so the calibration carries over), but
// also returns the specific claims the snippets do NOT support, so /ask can
// surface unsupportedClaims and decide to abstain. Reuses buildJudgeUser.

export type AnswerGroundedness = { verdict: JudgeVerdict; unsupported: string[] }

export const ANSWER_JUDGE_SYSTEM = `You are an auditor checking whether an answer is grounded in
the provided source snippets.

Rules:
- The snippets are the ONLY valid grounding. Outside knowledge does not count as supported.
- Judge factual support only — not style or completeness.
- List every factual claim in the answer that the snippets do NOT support.

Return ONLY a JSON object:
{ "verdict": "supported" | "partially_supported" | "unsupported" | "unknown",
  "unsupported": ["<claim the snippets do not support>", ...] }`

const stripCodeFences = (raw: string): string => {
  let clean = raw.trim()
  if (clean.startsWith("```json")) {
    clean = clean.slice("```json".length)
  } else if (clean.startsWith("```")) {
    clean = clean.slice(3)
  }
  if (clean.endsWith("```")) {
    clean = clean.slice(0, -3)
  }
  return clean.trim()
}

/** Tolerant parse of the answer-grounding judge's JSON (verdict + unsupported claims). */
export const parseAnswerGroundedness = (raw: string): AnswerGroundedness => {
  let obj: { verdict?: unknown; unsupported?: unknown }
  try {
    obj = JSON.parse(stripCodeFences(raw)) as { verdict?: unknown; unsupported?: unknown }
  } catch {
    return { verdict: "unknown", unsupported: [] }
  }
  const v = obj.verdict
  const verdict: JudgeVerdict =
    v === "supported" || v === "partially_supported" || v === "unsupported" || v === "unknown"
      ? v
      : "unknown"
  const unsupported = Array.isArray(obj.unsupported)
    ? obj.unsupported
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : []
  return { verdict, unsupported }
}

/** Abstention policy: the substrate refuses to vouch for an ungrounded answer. */
export const shouldAbstain = (g: AnswerGroundedness): boolean =>
  g.verdict === "unsupported" || g.verdict === "unknown"

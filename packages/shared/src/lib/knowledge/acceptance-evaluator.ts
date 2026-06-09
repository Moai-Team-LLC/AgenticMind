/**
 * Acceptance evaluator — the second stage of the Knowledge Unit contract
 * (extract → EVALUATE). The extractor proposes candidate cards; this judge
 * decides, per candidate, whether it may be admitted: accept / reject / merge /
 * human_review. It is the admission gate the KU contract calls for.
 *
 * Flag-gated (KNOWLEDGE_ACCEPTANCE_EVALUATOR, default off) — one extra LLM call
 * at ingest. Off by default keeps ingestion zero-extra-cost; on, it sets each
 * card's `status` (approved / candidate) and drops rejected noise before storage.
 *
 * The prompt, schema, builder, and the pure `applyAcceptance` mapping are env-free
 * (unit-tested with canned verdicts); `evaluateAcceptance` wires the chat model.
 */

import type { CardInput } from "@agenticmind/shared/database/query/knowledge/cards"

import { okAsync, ResultAsync } from "neverthrow"
import * as z from "zod"

export const ACCEPTANCE_SYSTEM = `You are the admission gate for a knowledge base. For each numbered candidate
knowledge unit, decide whether it may be stored, judging ONLY what is shown:

- "accept": atomic, specific, reusable, and self-contained — a unit a future
  reader could act on or learn from.
- "reject": a conversation fragment, greeting, joke, vague opinion, restated
  question, or speculation-as-fact — not reusable knowledge.
- "merge": a near-duplicate of another candidate in this batch (note which).
- "human_review": plausibly useful but risky — an interpretation/inference, a
  sensitive/PII claim, or a low-confidence assertion that should be checked.

Be strict: when in doubt between accept and reject, prefer human_review.

Return ONLY JSON, one entry per candidate index:
{ "verdicts": [ { "index": <number>, "decision": "accept" | "reject" | "merge" | "human_review", "reason": "<one short clause>" } ] }`

export type AcceptanceDecision = "accept" | "reject" | "merge" | "human_review"

export const acceptanceResponseSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int(),
      decision: z.enum(["accept", "reject", "merge", "human_review"]),
      reason: z.string(),
    }),
  ),
})
export type AcceptanceResponse = z.infer<typeof acceptanceResponseSchema>

/** Renders the candidate cards into the judge's user turn. */
export const buildAcceptanceUser = (cards: readonly CardInput[]): string =>
  cards
    .map((c, i) => `Candidate [${i}] (${c.kind}, subject=${c.subjectValue}):\n${c.body}`)
    .join("\n\n")

/**
 * Applies the judge's verdicts to the candidate cards, returning the cards that
 * survive with their admission `status` set. Pure.
 *
 * - accept → status `approved` (retrievable).
 * - human_review / merge → status `candidate`, with the judge's reason recorded.
 * - reject → dropped (not stored).
 * - a missing verdict fails OPEN (→ approved) so judge omissions never silently
 *   discard good knowledge.
 */
export const applyAcceptance = (
  cards: readonly CardInput[],
  verdicts: readonly { index: number; decision: AcceptanceDecision; reason: string }[],
): CardInput[] => {
  const byIndex = new Map<number, { decision: AcceptanceDecision; reason: string }>()
  for (const v of verdicts) {
    if (!byIndex.has(v.index)) {
      byIndex.set(v.index, { decision: v.decision, reason: v.reason })
    }
  }
  const out: CardInput[] = []
  let i = -1
  for (const card of cards) {
    i += 1
    const verdict = byIndex.get(i)
    const decision = verdict?.decision ?? "accept"
    if (decision === "reject") {
      continue
    }
    if (decision === "accept") {
      out.push({ ...card, status: "approved" })
    } else {
      out.push({ ...card, status: "candidate", confidenceReason: verdict?.reason ?? null })
    }
  }
  return out
}

export type AcceptanceError = { readonly type: string; readonly message: string }

/**
 * Runs the acceptance judge over candidate cards and returns the survivors with
 * `status` set. Best-effort at the call site: on an empty batch this returns the
 * input unchanged. The chat model is imported lazily so the pure helpers above
 * stay env-free for unit tests.
 */
export const evaluateAcceptance = (
  cards: CardInput[],
): ResultAsync<CardInput[], AcceptanceError> => {
  if (cards.length === 0) {
    return okAsync<CardInput[], AcceptanceError>([])
  }
  return ResultAsync.fromPromise(
    import("@agenticmind/shared/lib/knowledge/llm"),
    (e): AcceptanceError => {
      return { type: "import_error", message: String(e) }
    },
  ).andThen((m) =>
    m
      .completeKnowledgeJson({
        system: ACCEPTANCE_SYSTEM,
        user: buildAcceptanceUser(cards),
        schema: acceptanceResponseSchema,
        purpose: "knowledge acceptance",
      })
      .map((raw) => applyAcceptance(cards, raw.verdicts))
      .mapErr((e): AcceptanceError => {
        return { type: e.type, message: e.message }
      }),
  )
}

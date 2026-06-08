/**
 * Answer-time faithfulness scoring — Tier A (structural, pure, zero extra LLM).
 *
 * Citations are *enforced* upstream (`parseCitations`), but "a sentence has a
 * [N] marker" is not the same as "the answer is grounded". This module turns the
 * already-parsed citations into three signals an agent can gate on, computed
 * with no extra model call and no added latency:
 *
 *  - `groundedness` — fraction of factual claim-sentences that carry a resolving
 *    citation marker (1.0 when the answer makes no claim that needs support).
 *  - `unsupportedClaims` — the claim-sentences with no resolving citation: the
 *    "confident but uncited" risk surface (capped to bound the payload).
 *  - `abstained` — the answer declined: no sources were retrieved, or it cited
 *    nothing and used a refusal phrasing. An honest "I don't know" is distinct
 *    from a confident-but-ungrounded answer (low `groundedness`, `abstained`
 *    false) — that distinction is the whole point.
 *
 * Tier B (semantic entailment of each claim against its cited snippet) layers on
 * top later behind a flag; the output shape here is forward-compatible.
 */

/** A sentence with fewer word tokens than this is treated as boilerplate, not a claim. */
const MIN_CLAIM_WORDS = 3
/** Upper bound on returned unsupported claims, so the envelope stays small. */
const MAX_UNSUPPORTED = 10

export type Faithfulness = {
  /** 0..1 — supported claim-sentences / claim-sentences (1 when there are none). */
  groundedness: number
  /** Claim-sentences carrying no resolving citation (capped at MAX_UNSUPPORTED). */
  unsupportedClaims: string[]
  /** The answer declined rather than asserting grounded facts. */
  abstained: boolean
}

/** Decline / hedge phrasings. Matched case-insensitively against normalised text. */
const REFUSAL_MARKERS: readonly string[] = [
  "couldn't produce a safe answer",
  "could not produce a safe answer",
  "couldn't find",
  "could not find",
  "i don't know",
  "i do not know",
  "i don't have enough",
  "i do not have enough",
  "not enough information",
  "insufficient information",
  "the sources are insufficient",
  "sources are insufficient",
  "no relevant sources",
  "don't have information",
  "do not have information",
  "not covered by the sources",
]

const CITATION_MARKER_RE = /\[(\d+)\]/g
const WORD_RE = /[\p{L}\p{N}]+/gu

const normWs = (s: string): string => s.replaceAll(/\s+/g, " ").trim()

/** Drops a leading list bullet or enumerator ("- ", "* ", "1. ", "2) ") from a claim. */
const stripLeadingMarker = (s: string): string => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")

const hasRefusalMarker = (text: string): boolean => {
  const lower = normWs(text).toLowerCase()
  return REFUSAL_MARKERS.some((m) => lower.includes(m))
}

const wordCount = (s: string): number => (s.match(WORD_RE) ?? []).length

/** Splits on newlines, then on sentence terminators followed by whitespace. */
const splitSentences = (text: string): string[] => {
  const out: string[] = []
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim()
    if (trimmed === "") {
      continue
    }
    for (const piece of trimmed.split(/(?<=[.!?])\s+/)) {
      const s = piece.trim()
      if (s !== "") {
        out.push(s)
      }
    }
  }
  return out
}

const citationNumbersIn = (sentence: string): number[] => {
  const out: number[] = []
  for (const m of sentence.matchAll(CITATION_MARKER_RE)) {
    const n = Number.parseInt(m[1] ?? "", 10)
    if (!Number.isNaN(n)) {
      out.push(n)
    }
  }
  return out
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/**
 * The claim-sentences that DO carry a resolving citation, paired with the
 * citation numbers that resolve — the input surface for Tier-B entailment
 * (faithfulness-entailment.ts). Pure; reuses the same sentence/claim parsing as
 * `scoreFaithfulness`, so Tier-A and Tier-B agree on what counts as a claim.
 */
export const supportedClaims = (
  answerText: string,
  citations: readonly { number: number }[],
): { claim: string; citedNumbers: number[] }[] => {
  const citedNumbers = new Set(citations.map((c) => c.number))
  const out: { claim: string; citedNumbers: number[] }[] = []
  for (const sentence of splitSentences(answerText)) {
    if (wordCount(sentence) < MIN_CLAIM_WORDS) {
      continue
    }
    const resolving = [...new Set(citationNumbersIn(sentence).filter((n) => citedNumbers.has(n)))]
    if (resolving.length === 0) {
      continue
    }
    out.push({ claim: normWs(stripLeadingMarker(sentence)), citedNumbers: resolving })
  }
  return out
}

/**
 * Scores an answer against its resolved citations. `sourceCount` is the number
 * of retrieved sources the synthesiser saw (0 ⇒ the engine was forced to decline).
 * `citations` need only carry their resolved `number`.
 */
export const scoreFaithfulness = (
  answerText: string,
  citations: readonly { number: number }[],
  sourceCount: number,
): Faithfulness => {
  const citedNumbers = new Set(citations.map((c) => c.number))
  const abstained = sourceCount <= 0 || (citations.length === 0 && hasRefusalMarker(answerText))

  let needsSupport = 0
  let supported = 0
  const unsupportedClaims: string[] = []
  for (const sentence of splitSentences(answerText)) {
    if (wordCount(sentence) < MIN_CLAIM_WORDS) {
      continue
    }
    const marks = citationNumbersIn(sentence)
    const isSupported = marks.some((n) => citedNumbers.has(n))
    // A pure decline/hedge (no resolving citation) is not a factual claim.
    if (!isSupported && hasRefusalMarker(sentence)) {
      continue
    }
    needsSupport += 1
    if (isSupported) {
      supported += 1
    } else if (unsupportedClaims.length < MAX_UNSUPPORTED) {
      unsupportedClaims.push(normWs(stripLeadingMarker(sentence)))
    }
  }

  const groundedness = needsSupport === 0 ? 1 : round3(supported / needsSupport)
  return { groundedness, unsupportedClaims, abstained }
}

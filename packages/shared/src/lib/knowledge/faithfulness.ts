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

/** Maximal numeric figures: digits with optional thousands-commas, decimal, percent. */
const FIGURE_RE = /\d[\d,]*(?:\.\d+)?%?/g

/**
 * Deterministic anti-hallucination check (Tier-A, no LLM): every *substantial*
 * numeric figure asserted in the answer must appear in at least one cited snippet.
 * Tier-A's citation-presence check passes a sentence that merely carries a citation
 * marker — it never verifies the NUMBER itself, so a fabricated figure in a cited
 * sentence slips through. This catches that, the highest-impact hallucination class.
 *
 * Conservative by design (favour under-flagging): a figure is "grounded" if its
 * digit core appears anywhere in the snippets (commas normalised away); lone single
 * digits and word-numbers are ignored so "2 reviewers" never false-flags. Returns
 * the unsupported figures, as written.
 */
export const ungroundedFigures = (
  answerText: string,
  citedSnippets: readonly string[],
): string[] => {
  const haystack = citedSnippets.join("  ").replaceAll(",", "")
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of answerText.matchAll(FIGURE_RE)) {
    const raw = match[0]
    const core = raw.replaceAll(",", "").replace(/%$/u, "")
    const digits = core.replaceAll(".", "")
    // Skip insignificant figures (a lone 0–9 with no comma/decimal/percent).
    if (digits.length < 2 && !raw.includes(".") && !raw.endsWith("%")) {
      continue
    }
    if (seen.has(core)) {
      continue
    }
    seen.add(core)
    if (!haystack.includes(core)) {
      out.push(raw)
    }
  }
  return out
}

/** Double-quoted spans (straight or curly), capturing the inner text. */
const QUOTE_RE = /[“"]([^“”"]{1,200})[”"]/gu
const QUOTE_MIN_WORDS = 3
const normQuote = (s: string): string =>
  s
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
    .replaceAll(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
    .trim()

/**
 * Deterministic anti-hallucination check (Tier-A, no LLM): every substantial
 * double-quoted phrase the answer presents as a direct quotation must appear,
 * verbatim, in a cited snippet. A fabricated quotation ("the policy states '…'")
 * is a distinct, high-trust-looking hallucination class that the numeric and
 * attribution checks miss. Whitespace/case/edge-punctuation normalised; only
 * quotes of ≥3 words are judged (skip single quoted terms/identifiers).
 */
export const ungroundedQuotes = (
  answerText: string,
  citedSnippets: readonly string[],
): string[] => {
  const haystack = normQuote(citedSnippets.join("  "))
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of answerText.matchAll(QUOTE_RE)) {
    const inner = match[1] ?? ""
    if (wordCount(inner) < QUOTE_MIN_WORDS) {
      continue
    }
    const norm = normQuote(inner)
    if (norm === "" || seen.has(norm)) {
      continue
    }
    seen.add(norm)
    if (!haystack.includes(norm)) {
      out.push(inner.trim())
    }
  }
  return out
}

/** Common words excluded when checking claim↔citation content overlap. */
const ATTRIB_STOPWORDS = new Set<string>([
  "this",
  "that",
  "these",
  "those",
  "there",
  "their",
  "which",
  "where",
  "when",
  "what",
  "with",
  "from",
  "into",
  "over",
  "under",
  "about",
  "after",
  "before",
  "between",
  "have",
  "has",
  "had",
  "been",
  "being",
  "will",
  "would",
  "should",
  "could",
  "must",
  "they",
  "them",
  "then",
  "than",
  "also",
  "such",
  "each",
  "some",
  "more",
  "most",
  "only",
  "other",
  "because",
])
/** A cited claim sharing fewer salient content words than this with its snippet... */
const MIN_ATTRIB_TOKENS = 5
const contentTokens = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9]{4,}/gu) ?? []).filter((t) => !ATTRIB_STOPWORDS.has(t))

/**
 * Deterministic citation-attribution check (Tier-A, no LLM): a substantial cited
 * claim whose own snippet shares ZERO salient content words is almost certainly
 * mis-attributed — the citation marker points at an unrelated passage. Tier-A
 * checks the marker resolves; B checks numbers; this catches a fabricated
 * *non-numeric* claim wearing a decorative/wrong citation.
 *
 * Conservative (favour under-flagging): only claims with ≥5 salient content words
 * are judged, and only a TOTAL miss (no shared salient word, even accounting for
 * paraphrase, where a real claim keeps at least one noun/entity) is flagged.
 * Returns the weakly-attributed claims.
 */
export const weaklyAttributedClaims = (
  answerText: string,
  citations: readonly { number: number; snippet?: string }[],
): string[] => {
  const snippetByNum = new Map(citations.map((c) => [c.number, c.snippet ?? ""]))
  const out: string[] = []
  for (const sentence of splitSentences(answerText)) {
    if (wordCount(sentence) < MIN_CLAIM_WORDS || hasRefusalMarker(sentence)) {
      continue
    }
    const resolving = [...new Set(citationNumbersIn(sentence))].filter((n) => snippetByNum.has(n))
    if (resolving.length === 0) {
      continue // Tier-A already counts an unresolved/uncited claim as unsupported.
    }
    const claimToks = new Set(contentTokens(stripLeadingMarker(sentence)))
    if (claimToks.size < MIN_ATTRIB_TOKENS) {
      continue // too short to judge attribution reliably
    }
    const snipToks = new Set(resolving.flatMap((n) => contentTokens(snippetByNum.get(n) ?? "")))
    const shared = [...claimToks].some((t) => snipToks.has(t))
    if (!shared) {
      out.push(normWs(stripLeadingMarker(sentence)))
    }
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

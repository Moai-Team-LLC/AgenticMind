/**
 * Query stop-word filtering. Applied before retrieval so the embedder and BM25
 * see a denser content-signal query. Conservative list (articles, prepositions,
 * conjunctions, fillers); negation and question words are kept.
 */

const EN_STOPWORDS_LIGHT = new Set<string>([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "as",
  "from",
  "into",
  "about",
  "please",
  "tell",
  "show",
  "find",
  "me",
])

// Surrounding punctuation trimmed from each word before the stop-word check.
const TRIM_PUNCT = /^[.,;:!?"'(){}[\]]+|[.,;:!?"'(){}[\]]+$/gu

/**
 * Strips stop-words and excess whitespace. Returns the input verbatim if
 * filtering would leave nothing (short queries like "the" survive so BM25 can
 * still try). Case-preserving.
 */
export const normaliseQuery = (input: string): string => {
  const q = input.trim()
  if (q === "") {
    return ""
  }
  const words = q.split(/\s+/u).filter((w) => w !== "")
  if (words.length <= 1) {
    return q
  }
  const kept: string[] = []
  for (const w of words) {
    const lw = w.replace(TRIM_PUNCT, "").toLowerCase()
    if (lw === "") {
      continue
    }
    if (EN_STOPWORDS_LIGHT.has(lw)) {
      continue
    }
    kept.push(w)
  }
  if (kept.length === 0) {
    return q
  }
  return kept.join(" ")
}

/**
 * Returns the normalised query as a single-element variant list (empty/blank
 * input → []). Kept as a list so call sites that fan out over query variants
 * stay unchanged.
 */
export const queryVariants = (input: string): string[] => {
  const q = normaliseQuery(input.trim())
  return q === "" ? [] : [q]
}

/**
 * Deterministic text chunker — ported from services/knowledge/internal/index
 * (chunker.go). Splits a body into overlapping, embedding-sized chunks with
 * Markdown-heading awareness: the document is carved into heading-bounded
 * sections and every emitted chunk is prefixed with its parent heading so
 * vector retrieval can match on the section title literally.
 *
 * Determinism: same input → same output. Rune (code-point) semantics match Go
 * via Array.from, so chunk boundaries line up with the original.
 */

export const DEFAULT_MAX_RUNES = 900
export const DEFAULT_OVERLAP = 100

export type ChunkOptions = {
  /** Soft target chunk size in runes. Must be > overlap. */
  maxRunes?: number
  /** Trailing runes of chunk N prefixed onto chunk N+1. */
  overlap?: number
}

type Section = {
  /** e.g. "## Pricing" — empty for the prologue / heading-less docs. */
  heading: string
  /** Section content WITHOUT the heading line. */
  body: string
}

// ATX Markdown heading at the start of a line: 1–6 hashes, a space, then text.
const HEADING_RE = /^(#{1,6}) +(.+)$/gm

/**
 * Splits text into chunks. Trims surrounding whitespace, normalises CRLF, and
 * drops empty chunks. Prefers paragraph → line → sentence boundaries, falling
 * back to a hard cut only when a single paragraph exceeds the budget.
 */
export const splitText = (text: string, options: ChunkOptions = {}): string[] => {
  let maxRunes = options.maxRunes ?? DEFAULT_MAX_RUNES
  let overlap = options.overlap ?? DEFAULT_OVERLAP
  if (maxRunes <= 0) maxRunes = DEFAULT_MAX_RUNES
  if (overlap < 0) overlap = 0
  if (overlap >= maxRunes) overlap = Math.floor(maxRunes / 4)

  const body = text.replaceAll("\r\n", "\n").trim()
  if (body === "") return []

  const out: string[] = []
  for (const sec of splitByHeadings(body)) {
    out.push(...splitSection(sec, maxRunes, overlap))
  }
  return out
}

const splitByHeadings = (body: string): Section[] => {
  const matches = [...body.matchAll(HEADING_RE)]
  if (matches.length === 0) return [{ heading: "", body }]

  const out: Section[] = []
  const firstIndex = matches[0]?.index ?? 0
  // Prologue — text before the first heading.
  if (firstIndex > 0) {
    const prologue = body.slice(0, firstIndex).trim()
    if (prologue !== "") out.push({ heading: "", body: prologue })
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!
    const start = m.index ?? 0
    const headingEnd = start + m[0].length
    const bodyEnd = i + 1 < matches.length ? (matches[i + 1]?.index ?? body.length) : body.length
    // Keep the literal "# " prefix so emitted chunks start with the markdown.
    const heading = body.slice(start, headingEnd).replace(/[\r\n]+$/, "")
    const secBody = body.slice(headingEnd, bodyEnd).trim()
    out.push({ heading, body: secBody })
  }
  return out
}

const splitSection = (sec: Section, maxRunes: number, overlap: number): string[] => {
  let prefix = sec.heading !== "" ? `${sec.heading}\n\n` : ""
  const prefixRunes = Array.from(prefix).length
  let budget = maxRunes - prefixRunes
  if (budget < 200) {
    // Pathologically long heading — drop the prefix rather than emit junk.
    prefix = ""
    budget = maxRunes
  }

  const body = sec.body
  if (body === "") return []
  const runes = Array.from(body)
  if (runes.length <= budget) return [(prefix + body).trim()]

  const out: string[] = []
  let start = 0
  while (start < runes.length) {
    const end = start + budget
    if (end >= runes.length) {
      const piece = runes.slice(start).join("").trim()
      if (piece !== "") out.push((prefix + piece).trim())
      break
    }
    const boundary = findBoundary(runes, start, end)
    const piece = runes.slice(start, boundary).join("").trim()
    if (piece !== "") out.push((prefix + piece).trim())
    let next = boundary - overlap
    if (next <= start) next = boundary
    start = next
  }
  return out
}

/**
 * Rightmost boundary in (start, end] preferring paragraph (\n\n), then line
 * (\n), then sentence (. ? !), falling back to `end`. Looks back at most 200
 * runes for a clean break.
 */
const findBoundary = (runes: string[], start: number, endInput: number): number => {
  const end = endInput > runes.length ? runes.length : endInput
  let lookback = end - 200
  if (lookback < start) lookback = start

  const dbl = lastDoubleNewline(runes, lookback, end)
  if (dbl > 0) return dbl

  const nl = lastIndex(runes, lookback, end, "\n")
  if (nl > 0) return nl + 1

  for (let i = end - 1; i >= lookback; i--) {
    const r = runes[i]
    if (r === "." || r === "?" || r === "!") {
      // Skip mid-decimal punctuation (e.g. "1.5"): next rune must be a break.
      if (i + 1 >= runes.length || runes[i + 1] === " " || runes[i + 1] === "\n") return i + 1
    }
  }
  return end
}

const lastDoubleNewline = (runes: string[], lo: number, hi: number): number => {
  for (let i = hi - 1; i >= lo + 1; i--) {
    if (runes[i] === "\n" && runes[i - 1] === "\n") return i + 1
  }
  return -1
}

const lastIndex = (runes: string[], lo: number, hi: number, target: string): number => {
  for (let i = hi - 1; i >= lo; i--) {
    if (runes[i] === target) return i
  }
  return -1
}

/**
 * Estimates a chunk's token count via the 4-runes-per-token heuristic OpenAI
 * uses in its cost estimator — accurate enough to budget a chunk against the
 * 8192-token context.
 */
export const approxTokens = (s: string): number => {
  const n = Array.from(s).length
  if (n === 0) return 0
  const tokens = Math.floor((n + 3) / 4)
  return tokens < 1 ? 1 : tokens
}

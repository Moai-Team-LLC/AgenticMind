/**
 * Text sanitisation for the indexing pipeline — ported from sanitizeForText in
 * services/knowledge/internal/index/indexer.go. Postgres `text` columns reject
 * NUL (0x00, SQLSTATE 22021) and lone surrogates; PDF extractors occasionally
 * emit stray control characters. Strip them before chunk/embed/persist.
 */

// NUL + ASCII control chars, keeping tab (0x09), newline (0x0A), CR (0x0D).
const STRAY_CONTROL = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g")
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

/**
 * Removes NUL + stray control characters and replaces lone surrogates with the
 * Unicode replacement char so the body can always be persisted as text. Pure.
 */
export const sanitizeForText = (s: string): string => {
  if (s === "") return s
  let out = s.replace(STRAY_CONTROL, "")
  // Lone surrogates are invalid UTF-8 — Postgres rejects them. toWellFormed
  // (ES2024) replaces them with U+FFFD; fall back to a manual scan otherwise.
  const withToWellFormed = out as string & { toWellFormed?: () => string }
  out =
    typeof withToWellFormed.toWellFormed === "function"
      ? withToWellFormed.toWellFormed()
      : out.replace(LONE_SURROGATE, "�")
  return out
}

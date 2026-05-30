/**
 * Knowledge-card domain constants — ported from
 * services/knowledge/internal/cards/cards.go. Kinds back the CHECK constraint
 * on knowledge_cards; extraction caps mirror the Go extractor.
 */

export const CARD_KINDS = ["fact", "qa", "definition", "metric", "procedure", "resolution"] as const
export type CardKind = (typeof CARD_KINDS)[number]

export const isCardKind = (value: string): value is CardKind =>
  (CARD_KINDS as readonly string[]).includes(value)

/** Prompt+schema version stamped on every extracted card (stale-replay key). */
export const CURRENT_EXTRACTOR_VERSION = "v1"
/** Max material text sent to the extractor. */
export const CARDS_MAX_BODY_CHARS = 16_000
/** LLM extraction timeout. */
export const CARDS_TIMEOUT_MS = 90_000
/** Soft cap on cards accepted from one extraction call. */
export const MAX_CARDS_PER_MATERIAL = 50

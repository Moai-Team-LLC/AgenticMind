/**
 * Knowledge-card domain constants. Kinds back the CHECK constraint
 * on knowledge_cards; extraction caps mirror the extractor.
 */

export const CARD_KINDS = ["fact", "qa", "definition", "metric", "procedure", "resolution"] as const
export type CardKind = (typeof CARD_KINDS)[number]

export const isCardKind = (value: string): value is CardKind =>
  (CARD_KINDS as readonly string[]).includes(value)

/**
 * Knowledge Unit lifecycle (admission side of the KU contract). A card is born
 * `approved` (usable immediately — today's behaviour); the acceptance evaluator
 * or an admin can demote it. Retrieval skips the non-retrievable statuses.
 */
export const CARD_STATUSES = [
  "candidate",
  "reviewed",
  "approved",
  "rejected",
  "deprecated",
  "archived",
] as const
export type CardStatus = (typeof CARD_STATUSES)[number]

/** Statuses excluded from retrieval — rejected/superseded knowledge must not surface. */
export const NON_RETRIEVABLE_CARD_STATUSES: readonly CardStatus[] = [
  "rejected",
  "deprecated",
  "archived",
]

export const isCardStatus = (value: string): value is CardStatus =>
  (CARD_STATUSES as readonly string[]).includes(value)

/** Prompt+schema version stamped on every extracted card (stale-replay key). */
export const CURRENT_EXTRACTOR_VERSION = "v1"
/** Max material text sent to the extractor. */
export const CARDS_MAX_BODY_CHARS = 16_000
/** LLM extraction timeout. */
export const CARDS_TIMEOUT_MS = 90_000
/** Soft cap on cards accepted from one extraction call. */
export const MAX_CARDS_PER_MATERIAL = 50

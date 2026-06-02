/**
 * Embedding vector dimension — the single source of truth for every `vector(N)`
 * column across the knowledge schema (chunks, beliefs, knowledge_cards,
 * answer_cache, ask_clusters).
 *
 * Pinned to the default multilingual embedding model (BAAI/bge-m3 → 1024 dims).
 * Changing this value is a BREAKING change: it requires a schema migration and a
 * full re-embed of the corpus. A configured embedding model whose output length
 * differs from this constant fails fast at runtime (see lib/ai/embeddings.ts).
 */
export const EMBEDDING_DIMENSIONS = 1024

/**
 * Postgres full-text search configuration for the generated `*_tsv` columns and
 * the BM25 query side (they MUST match or FTS silently returns nothing).
 *
 * Default `simple` is language-neutral (no stemming, all languages tokenized
 * equally) — the right multilingual default. App-level stopword stripping
 * (lib/knowledge/stopwords) compensates for `simple` not removing stopwords.
 * Set to a language config (e.g. `english`, `russian`) for stemmed recall in a
 * single-language deployment; changing it is a schema migration (the generated
 * columns are rebuilt).
 */
export const FTS_CONFIG = "simple"

export const SUPPORTED_LANGUAGES = [
  "simple",
  "arabic",
  "danish",
  "dutch",
  "english",
  "finnish",
  "french",
  "german",
  "indonesian",
  "italian",
  "norwegian",
  "portuguese",
  "russian",
  "spanish",
  "swedish",
  "turkish",
] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const isSupportedLanguage = (lang: string): lang is SupportedLanguage => 
  (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)


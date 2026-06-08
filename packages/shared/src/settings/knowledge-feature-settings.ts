// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

/**
 * Knowledge feature flags + blob bucket. Env-controlled
 * (KNOWLEDGE_CARDS_ENABLED, etc.); they gate the cards/cache/graphrag tiers and
 * locate the ingestion blob bucket. All optional — absence = disabled / nop
 * blob store, so a minimal deployment (vector RAG only) still works.
 *
 * `S3_BUCKET` is the storage on/off switch (kept here, in the all-optional
 * module, so reading it never forces the required S3 credentials in
 * storage-settings to validate). The deprecated `SPACES_KNOWLEDGE_BUCKET` is
 * accepted as a fallback.
 */
export const knowledgeFeatureSettings = createEnv({
  server: {
    KNOWLEDGE_CARDS_ENABLED: z.string().optional(),
    KNOWLEDGE_CACHE_ENABLED: z.string().optional(),
    KNOWLEDGE_GRAPHRAG_ENABLED: z.string().optional(),
    // Tier-B answer faithfulness: semantic entailment of each cited claim against
    // its snippet (one extra LLM call per kl_ask_global). Off by default — Tier-A
    // structural groundedness is always computed for free.
    KNOWLEDGE_FAITHFULNESS_TIER_B: z.string().optional(),
    // Contested-sources detection: surface facts the retrieved sources disagree on
    // (one extra LLM call per kl_ask_global). Off by default.
    KNOWLEDGE_CONTESTED_SOURCES: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    // Active corpus-adaptive retrieval profile (Lever 3.2) — a JSON object
    // (hybridWeights / recencyConfig / topK / rerankTopN). Unset = engine defaults.
    // Produced by scripts/tune.ts. Malformed values fall back to defaults.
    RETRIEVAL_PARAMS: z.string().optional(),
  },
  runtimeEnv: {
    KNOWLEDGE_CARDS_ENABLED: process.env.KNOWLEDGE_CARDS_ENABLED,
    KNOWLEDGE_CACHE_ENABLED: process.env.KNOWLEDGE_CACHE_ENABLED,
    KNOWLEDGE_GRAPHRAG_ENABLED: process.env.KNOWLEDGE_GRAPHRAG_ENABLED,
    KNOWLEDGE_FAITHFULNESS_TIER_B: process.env.KNOWLEDGE_FAITHFULNESS_TIER_B,
    KNOWLEDGE_CONTESTED_SOURCES: process.env.KNOWLEDGE_CONTESTED_SOURCES,
    S3_BUCKET: process.env.S3_BUCKET ?? process.env.SPACES_KNOWLEDGE_BUCKET,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    RETRIEVAL_PARAMS: process.env.RETRIEVAL_PARAMS,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})

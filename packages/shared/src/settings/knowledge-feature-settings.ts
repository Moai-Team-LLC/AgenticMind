// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

/**
 * Knowledge feature flags + blob bucket. These were env-controlled inside the
 * Go service (KNOWLEDGE_CARDS_ENABLED, etc.); in the absorbed TS layer they
 * gate the cards/cache/graphrag tiers and locate the ingestion blob bucket.
 * All optional — absence = disabled / nop blob store, so a minimal deployment
 * (vector RAG only) still works.
 */
export const knowledgeFeatureSettings = createEnv({
  server: {
    KNOWLEDGE_CARDS_ENABLED: z.string().optional(),
    KNOWLEDGE_CACHE_ENABLED: z.string().optional(),
    KNOWLEDGE_GRAPHRAG_ENABLED: z.string().optional(),
    SPACES_KNOWLEDGE_BUCKET: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  },
  runtimeEnv: {
    KNOWLEDGE_CARDS_ENABLED: process.env.KNOWLEDGE_CARDS_ENABLED,
    KNOWLEDGE_CACHE_ENABLED: process.env.KNOWLEDGE_CACHE_ENABLED,
    KNOWLEDGE_GRAPHRAG_ENABLED: process.env.KNOWLEDGE_GRAPHRAG_ENABLED,
    SPACES_KNOWLEDGE_BUCKET: process.env.SPACES_KNOWLEDGE_BUCKET,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})

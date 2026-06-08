/**
 * Knowledge dependency factory for the web server. Builds the singletons the
 * knowledge libs need — blob store (S3-compatible), optional GraphRAG repo —
 * and reads the feature flags that gate cards / cache / graphrag. Used by the
 * knowledge tRPC router (Tier-3 rewiring) so the procedures call the TS libs
 * directly.
 */

import type { KnowledgeBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import type { GraphStore } from "@agenticmind/shared/lib/knowledge/graph-store"

import { blobStoreForBucket } from "@agenticmind/shared/lib/knowledge/blobstore"
import { createPostgresGraphStore } from "@agenticmind/shared/lib/knowledge/graphrag-postgres"
import { knowledgeFeatureSettings } from "@agenticmind/shared/settings/knowledge-feature-settings"
import { storageSettings } from "@agenticmind/shared/settings/storage-settings"

import { getDb } from "@/server/lib/database"

export type KnowledgeFeatureFlags = {
  cardsEnabled: boolean
  cacheEnabled: boolean
  graphragEnabled: boolean
  faithfulnessTierBEnabled: boolean
  contestedSourcesEnabled: boolean
}

/** Env-controlled tier flags (cards / answer-cache / graphrag / Tier-B / contested). */
export const knowledgeFeatureFlags = (): KnowledgeFeatureFlags => {
  return {
    cardsEnabled: knowledgeFeatureSettings.KNOWLEDGE_CARDS_ENABLED === "true",
    cacheEnabled: knowledgeFeatureSettings.KNOWLEDGE_CACHE_ENABLED === "true",
    graphragEnabled: knowledgeFeatureSettings.KNOWLEDGE_GRAPHRAG_ENABLED === "true",
    faithfulnessTierBEnabled: knowledgeFeatureSettings.KNOWLEDGE_FAITHFULNESS_TIER_B === "true",
    contestedSourcesEnabled: knowledgeFeatureSettings.KNOWLEDGE_CONTESTED_SOURCES === "true",
  }
}

let cachedBlobStore: KnowledgeBlobStore | undefined

/**
 * The ingestion blob store. Falls back to a no-op store (returns nop:// URIs,
 * never persists) when S3_BUCKET is unset — uploads still create material rows;
 * the raw bytes just aren't retained for re-indexing.
 */
export const getKnowledgeBlobStore = (): KnowledgeBlobStore => {
  if (cachedBlobStore !== undefined) {
    return cachedBlobStore
  }
  cachedBlobStore = blobStoreForBucket({
    bucket: knowledgeFeatureSettings.S3_BUCKET,
    accessKeyId: storageSettings.S3_ACCESS_KEY_ID,
    secretAccessKey: storageSettings.S3_SECRET_ACCESS_KEY,
    region: storageSettings.S3_REGION,
    endpoint: storageSettings.S3_ENDPOINT,
    forcePathStyle: storageSettings.S3_FORCE_PATH_STYLE === "true",
  })
  return cachedBlobStore
}

let cachedGraph: GraphStore | undefined

/**
 * GraphRAG store — **Postgres only** (recursive-CTE traversal on the `kg_*`
 * tables, no extra service). Graph usage is gated by the `graphragEnabled`
 * feature flag at the call site. Returns `| undefined` purely so existing
 * call-site `!== undefined` guards keep compiling; it never returns undefined.
 */
export const getKnowledgeGraphRepo = (): GraphStore | undefined => {
  if (cachedGraph !== undefined) {
    return cachedGraph
  }
  cachedGraph = createPostgresGraphStore(getDb())
  return cachedGraph
}

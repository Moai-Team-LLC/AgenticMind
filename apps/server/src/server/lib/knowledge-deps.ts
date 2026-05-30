/**
 * Knowledge dependency factory for the web server. Builds the singletons the
 * ported knowledge libs need — blob store (DigitalOcean Spaces), optional
 * GraphRAG Neo4j repo — and reads the feature flags that gate cards / cache /
 * graphrag. Used by the knowledge tRPC router (Tier-3 rewiring) so the
 * procedures call TS libs directly instead of proxying the Go service.
 */

import type { GraphStore } from "@agenticmind/shared/lib/knowledge/graph-store"

import {
  createS3BlobStore,
  type KnowledgeBlobStore,
  nopBlobStore,
} from "@agenticmind/shared/lib/knowledge/blobstore"
import { createPostgresGraphStore } from "@agenticmind/shared/lib/knowledge/graphrag-postgres"
import { knowledgeFeatureSettings } from "@agenticmind/shared/settings/knowledge-feature-settings"
import { spacesSettings } from "@agenticmind/shared/settings/spaces-settings"

import { getDb } from "@/server/lib/database"

export type KnowledgeFeatureFlags = {
  cardsEnabled: boolean
  cacheEnabled: boolean
  graphragEnabled: boolean
}

/** Env-controlled tier flags (cards / answer-cache / graphrag). */
export const knowledgeFeatureFlags = (): KnowledgeFeatureFlags => ({
  cardsEnabled: knowledgeFeatureSettings.KNOWLEDGE_CARDS_ENABLED === "true",
  cacheEnabled: knowledgeFeatureSettings.KNOWLEDGE_CACHE_ENABLED === "true",
  graphragEnabled: knowledgeFeatureSettings.KNOWLEDGE_GRAPHRAG_ENABLED === "true",
})

let cachedBlobStore: KnowledgeBlobStore | undefined

/**
 * The ingestion blob store. Falls back to a no-op store (returns nop:// URIs,
 * never persists) when SPACES_KNOWLEDGE_BUCKET is unset — uploads still create
 * material rows; the raw bytes just aren't retained for re-indexing.
 */
export const getKnowledgeBlobStore = (): KnowledgeBlobStore => {
  if (cachedBlobStore !== undefined) return cachedBlobStore
  const bucket = knowledgeFeatureSettings.SPACES_KNOWLEDGE_BUCKET
  cachedBlobStore =
    bucket === undefined || bucket === ""
      ? nopBlobStore
      : createS3BlobStore({
          region: spacesSettings.SPACES_REGION,
          accessKeyId: spacesSettings.SPACES_ACCESS_KEY,
          secretAccessKey: spacesSettings.SPACES_SECRET_KEY,
          bucket,
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
  if (cachedGraph !== undefined) return cachedGraph
  cachedGraph = createPostgresGraphStore(getDb())
  return cachedGraph
}

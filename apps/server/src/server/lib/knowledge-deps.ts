/**
 * Knowledge dependency factory for the web server. Builds the singletons the
 * knowledge libs need — blob store (S3-compatible) — and reads the feature
 * flags that gate cards / cache. Used by the knowledge tRPC router (Tier-3
 * rewiring) so the procedures call the TS libs directly.
 */

import type { KnowledgeBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"

import { blobStoreForBucket } from "@agenticmind/shared/lib/knowledge/blobstore"
import { knowledgeFeatureSettings } from "@agenticmind/shared/settings/knowledge-feature-settings"
import { storageSettings } from "@agenticmind/shared/settings/storage-settings"

export type KnowledgeFeatureFlags = {
  cardsEnabled: boolean
  cacheEnabled: boolean
  faithfulnessTierBEnabled: boolean
  contestedSourcesEnabled: boolean
  evalHarvestEnabled: boolean
  acceptanceEvaluatorEnabled: boolean
  piiRedactionEnabled: boolean
}

/** Env-controlled tier flags (cards / cache / Tier-B / contested / harvest). */
export const knowledgeFeatureFlags = (): KnowledgeFeatureFlags => {
  return {
    cardsEnabled: knowledgeFeatureSettings.KNOWLEDGE_CARDS_ENABLED === "true",
    cacheEnabled: knowledgeFeatureSettings.KNOWLEDGE_CACHE_ENABLED === "true",
    faithfulnessTierBEnabled: knowledgeFeatureSettings.KNOWLEDGE_FAITHFULNESS_TIER_B === "true",
    contestedSourcesEnabled: knowledgeFeatureSettings.KNOWLEDGE_CONTESTED_SOURCES === "true",
    evalHarvestEnabled: knowledgeFeatureSettings.KNOWLEDGE_EVAL_HARVEST === "true",
    acceptanceEvaluatorEnabled: knowledgeFeatureSettings.KNOWLEDGE_ACCEPTANCE_EVALUATOR === "true",
    // Default ON: only an explicit "false" disables answer-side PII redaction.
    piiRedactionEnabled: knowledgeFeatureSettings.KNOWLEDGE_PII_REDACTION !== "false",
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

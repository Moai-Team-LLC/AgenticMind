/**
 * Embeddings provider seam — Agentic Product Standard, Layer 1 ("multi-provider
 * from the start"). Two implementations behind one interface:
 *
 *   - LocalEmbeddingsProvider  — in-process multilingual model via transformers.js
 *     (default: BAAI/bge-m3, 1024 dims). Zero key, offline, deterministic. This
 *     is what powers the zero-config `npx` tier and non-English self-hosters.
 *   - OpenAiEmbeddingsProvider — any OpenAI-compatible `/embeddings` endpoint
 *     (OpenAI, Ollama, vLLM, OpenRouter, …) via a dependency-free fetch.
 *
 * The vector dimension is pinned to EMBEDDING_DIMENSIONS (the DB schema constant);
 * a model whose output length differs fails fast with an actionable error.
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers"

import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { buildRetryOptions } from "@agenticmind/shared/lib/retry"
import { aiSettings } from "@agenticmind/shared/settings/ai-settings"
import { env, pipeline } from "@huggingface/transformers"
import pRetry from "p-retry"

export type EmbeddingsProvider = {
  readonly dimensions: number
  embed(text: string, purpose?: string): Promise<number[]>
  embedBatch(texts: string[], purpose?: string): Promise<number[][]>
}

const assertDimensions = (vector: number[], modelId: string): number[] => {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embeddings: model '${modelId}' returned ${vector.length} dims, but the schema expects ${EMBEDDING_DIMENSIONS}. ` +
        `Set EMBED_MODEL to a ${EMBEDDING_DIMENSIONS}-dim model, or change EMBEDDING_DIMENSIONS and re-run migrations + re-embed.`,
    )
  }
  return vector
}

/** In-process local model (transformers.js). The pipeline is created lazily on
 * first use and cached for the process lifetime. */
const createLocalProvider = (modelId: string, pooling: "cls" | "mean"): EmbeddingsProvider => {
  // Make the first-use model download work behind a blocked Hugging Face CDN
  // (cdn-lfs.huggingface.co / cas-bridge.xethub.hf.co). EMBED_HF_ENDPOINT points
  // downloads at a mirror (e.g. https://hf-mirror.com); EMBED_CACHE_DIR persists
  // the model so it downloads once and can be pre-seeded for offline installs.
  const endpoint = aiSettings.EMBED_HF_ENDPOINT
  if (endpoint !== undefined && endpoint !== "") {
    env.remoteHost = endpoint.replace(/\/+$/u, "")
  }
  if (aiSettings.EMBED_CACHE_DIR !== undefined && aiSettings.EMBED_CACHE_DIR !== "") {
    env.cacheDir = aiSettings.EMBED_CACHE_DIR
  }
  let pipe: Promise<FeatureExtractionPipeline> | null = null
  const getPipe = async (): Promise<FeatureExtractionPipeline> => {
    pipe ??= pipeline("feature-extraction", modelId)
    return pipe
  }
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    embed: async (text) => {
      const extractor = await getPipe()
      const out = await extractor(text, { pooling, normalize: true })
      return assertDimensions(Array.from(out.data as Float32Array), modelId)
    },
    embedBatch: async (texts) => {
      if (texts.length === 0) {
        return []
      }
      const extractor = await getPipe()
      const out = await extractor(texts, { pooling, normalize: true })
      const rows = out.tolist() as number[][]
      for (const row of rows) {
        assertDimensions(row, modelId)
      }
      return rows
    },
  }
}

/** Any OpenAI-compatible `/embeddings` endpoint, called with a dependency-free
 * fetch + the repo's standard retry policy. */
const createOpenAiProvider = (
  modelId: string,
  baseUrl: string,
  apiKey: string | undefined,
): EmbeddingsProvider => {
  const url = `${baseUrl.replace(/\/+$/u, "")}/embeddings`
  const callOnce = async (input: string | string[]): Promise<number[][]> => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey !== undefined && apiKey !== "" ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model: modelId, input }),
    })
    if (!response.ok) {
      throw new Error(`embeddings ${response.status}: ${await response.text()}`)
    }
    const json = (await response.json()) as { data: { embedding: number[] }[] }
    return json.data.map((d) => assertDimensions(d.embedding, modelId))
  }
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    embed: async (text, purpose = "embed") => {
      const rows = await pRetry(async () => callOnce(text), buildRetryOptions(purpose))
      const first = rows[0]
      if (first === undefined) {
        throw new Error("embeddings: empty response from endpoint")
      }
      return first
    },
    embedBatch: async (texts, purpose = "embed batch") => {
      if (texts.length === 0) {
        return []
      }
      return pRetry(async () => callOnce(texts), buildRetryOptions(purpose))
    },
  }
}

/** Defaults applied in code as well as in the zod schema: `@t3-oss/env-core`
 * skips `.default()` when SKIP_VALIDATION is set (which the repo's dev env does),
 * so the resolver must not rely on the schema defaults alone. */
const DEFAULT_EMBED_MODEL = "Xenova/bge-m3"
const DEFAULT_EMBED_POOLING = "cls" as const

/** The resolved embedding model id (config or default) — recorded on persisted
 * rows so re-embeds and model swaps stay auditable. */
export const configuredEmbeddingModelId = (): string =>
  aiSettings.EMBED_MODEL ?? DEFAULT_EMBED_MODEL

let cached: EmbeddingsProvider | null = null

/** Resolves the configured embeddings provider (singleton). */
export const embeddingsProvider = (): EmbeddingsProvider => {
  if (cached !== null) {
    return cached
  }
  const modelId = aiSettings.EMBED_MODEL ?? DEFAULT_EMBED_MODEL
  if (aiSettings.EMBED_PROVIDER === "openai") {
    if (aiSettings.EMBED_BASE_URL === undefined) {
      throw new Error("EMBED_PROVIDER=openai requires EMBED_BASE_URL")
    }
    cached = createOpenAiProvider(modelId, aiSettings.EMBED_BASE_URL, aiSettings.EMBED_API_KEY)
  } else {
    cached = createLocalProvider(modelId, aiSettings.EMBED_POOLING ?? DEFAULT_EMBED_POOLING)
  }
  return cached
}

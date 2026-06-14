/**
 * Knowledge LLM adapter — a thin wrapper over the shared AI layer (`lib/ai`)
 * for the RAG / cards / graphrag pipeline. It exposes:
 *   - Embedder.Embed      → embedKnowledgeText / embedKnowledgeBatch
 *   - ChatCompleter.Complete → completeKnowledge (system + user)
 *   - CompleteJSON        → completeKnowledgeJson (zod-validated)
 *
 * Embeddings are produced by the pluggable EmbeddingsProvider (lib/ai/embeddings):
 * a zero-key in-process multilingual model by default, or any OpenAI-compatible
 * endpoint. Dimensionality is pinned to the DB schema constant.
 */

import type { LlmModel } from "@agenticmind/shared/lib/ai/model"
import type * as z from "zod"

import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { chatModel } from "@agenticmind/shared/lib/ai/chat"
import {
  configuredEmbeddingModelId,
  embeddingsProvider,
} from "@agenticmind/shared/lib/ai/embeddings"
import { Attr, recordChildSpan, SpanKind } from "@agenticmind/shared/lib/observability/trace"
import { buildRetryOptions } from "@agenticmind/shared/lib/retry"
import { parseZodSchema } from "@agenticmind/shared/lib/zod/parse"
import { aiSettings } from "@agenticmind/shared/settings/ai-settings"
import { generateText, Output } from "ai"
import { okAsync, ResultAsync } from "neverthrow"
import pRetry from "p-retry"

/** Embedding dimensionality for the knowledge corpus (pinned to the DB schema). */
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS
/** Identifier of the configured embedding model — recorded on persisted rows
 * (`embedding_model`) so re-embeds and model swaps are auditable. */
export const KNOWLEDGE_EMBEDDING_MODEL = configuredEmbeddingModelId()
/** Default chat model for synthesis / extraction (OpenAI; override per provider). */
export const KNOWLEDGE_CHAT_MODEL: LlmModel = "gpt-4o"

export type KnowledgeAiError = {
  readonly type: "ai_error"
  readonly message: string
  readonly originalError: unknown
}

const aiError = (message: string, originalError: unknown): KnowledgeAiError => {
  return {
    type: "ai_error",
    message,
    originalError,
  }
}

/** Output-token ceiling fallback when the env default is skipped (SKIP_VALIDATION). */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/**
 * Emits a child LLM span carrying per-call token usage (Cost/FinOps, Layer 9),
 * using OpenInference attribute conventions. A no-op until an exporter is
 * registered, so it is safe on the hot path. Undefined usage fields are omitted.
 */
const recordLlmUsage = (
  name: string,
  modelId: string,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  startMs: number,
): void => {
  const attrs: Record<string, string | number> = { [Attr.LLM_MODEL]: modelId }
  if (usage.inputTokens !== undefined) {
    attrs[Attr.LLM_TOKEN_PROMPT] = usage.inputTokens
  }
  if (usage.outputTokens !== undefined) {
    attrs[Attr.LLM_TOKEN_COMPLETION] = usage.outputTokens
  }
  if (usage.totalTokens !== undefined) {
    attrs[Attr.LLM_TOKEN_TOTAL] = usage.totalTokens
  }
  recordChildSpan(name, SpanKind.LLM, startMs, Date.now(), attrs)
}

/** Embeds a single text into an EMBEDDING_DIMENSIONS-dim vector. */
export const embedKnowledgeText = (
  text: string,
  purpose = "knowledge embed",
): ResultAsync<number[], KnowledgeAiError> =>
  ResultAsync.fromPromise(embeddingsProvider().embed(text, purpose), (error) =>
    aiError(`Failed to embed text for ${purpose}`, error),
  )

/**
 * Embeds a batch of texts, preserving input order. Returns [] for an empty
 * input (empty input is a no-op fast-path).
 */
export const embedKnowledgeBatch = (
  texts: string[],
  purpose = "knowledge embed batch",
): ResultAsync<number[][], KnowledgeAiError> => {
  if (texts.length === 0) {
    return okAsync<number[][], KnowledgeAiError>([])
  }
  return ResultAsync.fromPromise(embeddingsProvider().embedBatch(texts, purpose), (error) =>
    aiError(`Failed to embed batch for ${purpose}`, error),
  )
}

/** Completes a chat turn from a system + user prompt. */
export const completeKnowledge = (props: {
  system: string
  user: string
  model?: LlmModel
  purpose?: string
}): ResultAsync<string, KnowledgeAiError> => {
  const purpose = props.purpose ?? "knowledge complete"
  return ResultAsync.fromPromise(
    pRetry(async () => {
      const start = Date.now()
      const { text, usage } = await generateText({
        model: chatModel(props.model ?? KNOWLEDGE_CHAT_MODEL),
        system: props.system,
        prompt: props.user,
        maxOutputTokens: aiSettings.CHAT_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS,
      })
      recordLlmUsage("llm.complete", props.model ?? KNOWLEDGE_CHAT_MODEL, usage, start)
      return text
    }, buildRetryOptions(purpose)),
    (error) => aiError(`Failed to complete for ${purpose}`, error),
  )
}

/**
 * Completes a chat turn constrained to a zod schema (JSON mode). The
 * `CompleteJSON` capability used by graphrag / cards / qaplan extraction.
 */
export const completeKnowledgeJson = <T>(props: {
  system: string
  user: string
  schema: z.ZodType<T>
  model?: LlmModel
  purpose?: string
}) => {
  const purpose = props.purpose ?? "knowledge complete json"
  return ResultAsync.fromPromise(
    pRetry(async () => {
      const start = Date.now()
      const { output, usage } = await generateText({
        model: chatModel(props.model ?? KNOWLEDGE_CHAT_MODEL),
        system: props.system,
        prompt: props.user,
        output: Output.object({ schema: props.schema }),
        maxOutputTokens: aiSettings.CHAT_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS,
      })
      recordLlmUsage("llm.complete.json", props.model ?? KNOWLEDGE_CHAT_MODEL, usage, start)
      return output
    }, buildRetryOptions(purpose)),
    (error) => aiError(`Failed to complete json for ${purpose}`, error),
  ).andThen((output) => parseZodSchema(props.schema, output))
}

/**
 * Knowledge LLM adapter — thin wrapper over the repo's shared AI layer
 * (`lib/ai`) for the RAG / cards / graphrag pipeline.
 *
 * Replaces services/knowledge/internal/llm. Rather than reimplement an
 * OpenAI client, this maps the Go interfaces onto the existing OpenRouter-
 * backed helpers:
 *   - Embedder.Embed      → embedKnowledgeText / embedKnowledgeBatch
 *   - ChatCompleter.Complete → completeKnowledge (system + user)
 *   - CompleteJSON        → completeKnowledgeJson (zod-validated)
 *
 * Embeddings stay at text-embedding-3-small / 1536 dims to match the Go RAG
 * tuning and the `chunks` / `knowledge_cards` vector(1536) columns.
 */

import type { EmbeddingModel, LlmModel } from "@agenticmind/shared/lib/ai/model"
import type * as z from "zod"

import { openrouterClient } from "@agenticmind/shared/lib/ai/openrouter"
import { buildRetryOptions } from "@agenticmind/shared/lib/retry"
import { parseZodSchema } from "@agenticmind/shared/lib/zod/parse"
import { embed, embedMany, generateText, Output } from "ai"
import { okAsync, ResultAsync } from "neverthrow"
import pRetry from "p-retry"

/** Embedding model + dimensionality for the knowledge corpus (matches Go). */
export const KNOWLEDGE_EMBEDDING_MODEL: EmbeddingModel = "openai/text-embedding-3-small"
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536
/** Default chat model for synthesis / extraction. */
export const KNOWLEDGE_CHAT_MODEL: LlmModel = "openai/gpt-5-mini"

export type KnowledgeAiError = {
  readonly type: "ai_error"
  readonly message: string
  readonly originalError: unknown
}

const aiError = (message: string, originalError: unknown): KnowledgeAiError => ({
  type: "ai_error",
  message,
  originalError,
})

/** Embeds a single text into a 1536-dim vector. */
export const embedKnowledgeText = (
  text: string,
  purpose = "knowledge embed",
): ResultAsync<number[], KnowledgeAiError> =>
  ResultAsync.fromPromise(
    pRetry(async () => {
      const { embedding } = await embed({
        model: openrouterClient.textEmbeddingModel(KNOWLEDGE_EMBEDDING_MODEL),
        value: text,
      })
      return embedding
    }, buildRetryOptions(purpose)),
    (error) => aiError(`Failed to embed text for ${purpose}`, error),
  )

/**
 * Embeds a batch of texts, preserving input order. Returns [] for an empty
 * input (mirrors the Go embedder's ErrEmptyInput fast-path as a no-op).
 */
export const embedKnowledgeBatch = (
  texts: string[],
  purpose = "knowledge embed batch",
): ResultAsync<number[][], KnowledgeAiError> => {
  if (texts.length === 0) return okAsync<number[][], KnowledgeAiError>([])
  return ResultAsync.fromPromise(
    pRetry(async () => {
      const { embeddings } = await embedMany({
        model: openrouterClient.textEmbeddingModel(KNOWLEDGE_EMBEDDING_MODEL),
        values: texts,
      })
      return embeddings
    }, buildRetryOptions(purpose)),
    (error) => aiError(`Failed to embed batch for ${purpose}`, error),
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
      const { text } = await generateText({
        model: openrouterClient(props.model ?? KNOWLEDGE_CHAT_MODEL),
        system: props.system,
        prompt: props.user,
      })
      return text
    }, buildRetryOptions(purpose)),
    (error) => aiError(`Failed to complete for ${purpose}`, error),
  )
}

/**
 * Completes a chat turn constrained to a zod schema (JSON mode). Replaces the
 * Go `CompleteJSON` capability used by graphrag / cards / qaplan extraction.
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
      const { output } = await generateText({
        model: openrouterClient(props.model ?? KNOWLEDGE_CHAT_MODEL),
        system: props.system,
        prompt: props.user,
        output: Output.object({ schema: props.schema }),
      })
      return output
    }, buildRetryOptions(purpose)),
    (error) => aiError(`Failed to complete json for ${purpose}`, error),
  ).andThen((output) => parseZodSchema(props.schema, output))
}

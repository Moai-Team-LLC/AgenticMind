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
import { providerFamily } from "@agenticmind/shared/lib/knowledge/judge-model"
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
  /** Sampling temperature; defaults to 0 (deterministic) — an extractor or judge whose
   * output changes run-to-run cannot be calibrated. A caller that wants diversity opts in. */
  temperature?: number
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
        temperature: props.temperature ?? 0,
        maxOutputTokens: aiSettings.CHAT_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS,
      })
      recordLlmUsage("llm.complete", props.model ?? KNOWLEDGE_CHAT_MODEL, usage, start)
      return text
    }, buildRetryOptions(purpose)),
    (error) => aiError(`Failed to complete for ${purpose}`, error),
  )
}

/**
 * Tolerant parse of a JSON object out of a model reply — strips markdown fences and, if
 * the body is prose-wrapped, falls back to the first `{`…last `}` slice. For non-OpenAI
 * judges (e.g. a Gemini model routed via the gateway) that don't honor strict
 * responseFormat and may return fenced/prefixed JSON. Throws when no object is present.
 */
export const parseJsonObjectLoose = (raw: string): unknown => {
  let clean = raw.trim()
  if (clean.startsWith("```json")) {
    clean = clean.slice("```json".length)
  } else if (clean.startsWith("```")) {
    clean = clean.slice(3)
  }
  if (clean.endsWith("```")) {
    clean = clean.slice(0, -3)
  }
  clean = clean.trim()
  try {
    return JSON.parse(clean)
  } catch {
    const first = clean.indexOf("{")
    const last = clean.lastIndexOf("}")
    if (first !== -1 && last > first) {
      return JSON.parse(clean.slice(first, last + 1))
    }
    throw new Error("model reply contained no JSON object")
  }
}

/**
 * Completes a chat turn constrained to a zod schema (JSON mode). The `CompleteJSON`
 * capability used by graphrag / cards / qaplan extraction and the verify judges.
 *
 * OpenAI honors strict structured outputs (`responseFormat`); other families — notably a
 * decorrelated Gemini judge routed via the gateway — reject it and can return prose- or
 * fence-wrapped JSON, so the strict path would drop the schema and the judge would fail
 * closed (silently `{}`). For those, ask for JSON in the prompt and parse defensively;
 * the final `parseZodSchema` still enforces the schema either way.
 */
export const completeKnowledgeJson = <T>(props: {
  system: string
  user: string
  schema: z.ZodType<T>
  model?: LlmModel
  /** Sampling temperature; defaults to 0 (deterministic) — see completeKnowledge. */
  temperature?: number
  purpose?: string
}) => {
  const purpose = props.purpose ?? "knowledge complete json"
  const model = props.model ?? KNOWLEDGE_CHAT_MODEL
  const temperature = props.temperature ?? 0
  const maxOutputTokens = aiSettings.CHAT_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS
  const nativeStructured = providerFamily(model) === "openai"
  return ResultAsync.fromPromise(
    pRetry(async (): Promise<unknown> => {
      const start = Date.now()
      if (nativeStructured) {
        const { output, usage } = await generateText({
          model: chatModel(model),
          system: props.system,
          prompt: props.user,
          temperature,
          output: Output.object({ schema: props.schema }),
          maxOutputTokens,
        })
        recordLlmUsage("llm.complete.json", model, usage, start)
        return output
      }
      const { text, usage } = await generateText({
        model: chatModel(model),
        system: `${props.system}\n\nReturn a single valid JSON object only — no prose, no markdown fences.`,
        prompt: props.user,
        temperature,
        maxOutputTokens,
      })
      recordLlmUsage("llm.complete.json", model, usage, start)
      return parseJsonObjectLoose(text)
    }, buildRetryOptions(purpose)),
    (error) => aiError(`Failed to complete json for ${purpose}`, error),
  ).andThen((output) => parseZodSchema(props.schema, output))
}

/**
 * Chat provider seam — Agentic Product Standard, Layer 1 ("multi-provider from
 * the start"). One OpenAI-compatible endpoint, configured by CHAT_BASE_URL +
 * CHAT_API_KEY: OpenAI by default, or Ollama / vLLM / OpenRouter / Together /
 * Groq / Azure — anything that speaks the OpenAI chat API. Pairs with the local
 * embeddings default for a fully offline, zero-cloud-key deployment.
 *
 * Tiered routing (cheap model for simple lookups, flagship for complex) is
 * preserved upstream in complexity.ts, which feeds the model id in here.
 */

import type { LanguageModel } from "ai"

import { aiSettings } from "@agenticmind/shared/settings/ai-settings"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

// Code-level default mirrors the zod default — `@t3-oss/env-core` skips `.default()`
// under SKIP_VALIDATION (which the dev env sets), so the resolver can't rely on it.
const DEFAULT_CHAT_BASE_URL = "https://api.openai.com/v1"

type CompatProvider = ReturnType<typeof createOpenAICompatible>
let compat: CompatProvider | null = null

const compatProvider = (): CompatProvider => {
  if (compat !== null) {
    return compat
  }
  compat = createOpenAICompatible({
    name: "agenticmind-chat",
    baseURL: aiSettings.CHAT_BASE_URL ?? DEFAULT_CHAT_BASE_URL,
    apiKey: aiSettings.CHAT_API_KEY,
  })
  return compat
}

/** Resolves the configured chat model for a given model id. */
export const chatModel = (modelId: string): LanguageModel => compatProvider()(modelId)

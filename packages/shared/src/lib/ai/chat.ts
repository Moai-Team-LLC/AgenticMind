/**
 * Chat provider seam — Agentic Product Standard, Layer 1 ("multi-provider from
 * the start"). Resolves a Vercel AI SDK language model for a given model id:
 *
 *   - `openrouter` (default, back-compat) — the existing OpenRouter client.
 *   - `openai`     — any OpenAI-compatible endpoint (OpenAI, Ollama, vLLM, …)
 *                    via CHAT_BASE_URL. Pairs with the local embeddings default
 *                    to give a fully offline, zero-cloud-key deployment.
 *
 * Tiered routing (cheap model for simple lookups, flagship for complex) is
 * preserved upstream in complexity.ts, which feeds the model id in here.
 */

import type { LanguageModel } from "ai"

import { openrouterClient } from "@agenticmind/shared/lib/ai/openrouter"
import { aiSettings } from "@agenticmind/shared/settings/ai-settings"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

type CompatProvider = ReturnType<typeof createOpenAICompatible>
let compat: CompatProvider | null = null

const compatProvider = (): CompatProvider => {
  if (compat !== null) {
    return compat
  }
  if (aiSettings.CHAT_BASE_URL === undefined) {
    throw new Error("CHAT_PROVIDER=openai requires CHAT_BASE_URL")
  }
  compat = createOpenAICompatible({
    name: "agenticmind-chat",
    baseURL: aiSettings.CHAT_BASE_URL,
    apiKey: aiSettings.CHAT_API_KEY,
  })
  return compat
}

/** Resolves the configured chat model for a given model id. */
export const chatModel = (modelId: string): LanguageModel => {
  if (aiSettings.CHAT_PROVIDER === "openai") {
    return compatProvider()(modelId)
  }
  return openrouterClient(modelId)
}

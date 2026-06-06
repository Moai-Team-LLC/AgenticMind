// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

/**
 * Provider-agnostic AI settings (Agentic Product Standard — Layer 1: multi-provider
 * from the start). Embeddings default to a zero-key, offline, in-process
 * multilingual model; chat is a single OpenAI-compatible endpoint (OpenAI by
 * default, or any compatible one — Ollama, vLLM, OpenRouter, … — via CHAT_BASE_URL).
 */
export const aiSettings = createEnv({
  server: {
    // ── Embeddings ──────────────────────────────────────────────────────
    // `local` runs an in-process transformers.js model (no key, offline).
    // `openai` calls any OpenAI-compatible /embeddings endpoint.
    EMBED_PROVIDER: z.enum(["local", "openai"]).default("local"),
    EMBED_MODEL: z.string().min(1).default("Xenova/bge-m3"),
    // Pooling strategy for the local model (bge-m3 → cls, e5 family → mean).
    EMBED_POOLING: z.enum(["cls", "mean"]).default("cls"),
    EMBED_BASE_URL: z.url().optional(),
    EMBED_API_KEY: z.string().optional(),
    // For the `local` provider behind a blocked Hugging Face CDN
    // (cdn-lfs.huggingface.co / cas-bridge.xethub.hf.co): point downloads at a
    // mirror (e.g. https://hf-mirror.com), and/or persist the model in a cache
    // dir you can pre-seed for fully offline / air-gapped installs.
    EMBED_HF_ENDPOINT: z.url().optional(),
    EMBED_CACHE_DIR: z.string().optional(),

    // ── Chat / synthesis ────────────────────────────────────────────────
    // One OpenAI-compatible endpoint. Defaults to OpenAI; point CHAT_BASE_URL at
    // any compatible API (Ollama http://localhost:11434/v1, vLLM, OpenRouter
    // https://openrouter.ai/api/v1, …) with its own CHAT_API_KEY + model ids.
    CHAT_BASE_URL: z.url().default("https://api.openai.com/v1"),
    CHAT_API_KEY: z.string().optional(),
    // Tiered routing: cheap/fast model for simple lookups, flagship for complex.
    CHAT_MODEL_SIMPLE: z.string().min(1).default("gpt-4o-mini"),
    CHAT_MODEL_COMPLEX: z.string().min(1).default("gpt-4o"),
    // Per-run output-token ceiling for synthesis/extraction — a cost circuit
    // breaker (Layer 9). Caps a single generation; the input side is bounded by
    // retrieval token-budgeting. Configurable per deployment.
    CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),

    // ── Rerank (optional cross-encoder, off by default) ─────────────────
    // When off, retrieval falls back to the fused vector+BM25 order (no extra
    // call, no key). Set RERANK_ENABLED="true" + RERANK_API_KEY for a native
    // Cohere reranker (or point RERANK_BASE_URL at any Cohere-compatible /rerank).
    RERANK_ENABLED: z.string().optional(),
    RERANK_BASE_URL: z.url().default("https://api.cohere.com/v2/rerank"),
    RERANK_API_KEY: z.string().optional(),
    RERANK_MODEL: z.string().min(1).default("rerank-v3.5"),
  },
  runtimeEnv: {
    EMBED_PROVIDER: process.env.EMBED_PROVIDER,
    EMBED_MODEL: process.env.EMBED_MODEL,
    EMBED_POOLING: process.env.EMBED_POOLING,
    EMBED_BASE_URL: process.env.EMBED_BASE_URL,
    EMBED_API_KEY: process.env.EMBED_API_KEY,
    EMBED_HF_ENDPOINT: process.env.EMBED_HF_ENDPOINT,
    EMBED_CACHE_DIR: process.env.EMBED_CACHE_DIR,
    CHAT_BASE_URL: process.env.CHAT_BASE_URL,
    CHAT_API_KEY: process.env.CHAT_API_KEY,
    CHAT_MODEL_SIMPLE: process.env.CHAT_MODEL_SIMPLE,
    CHAT_MODEL_COMPLEX: process.env.CHAT_MODEL_COMPLEX,
    CHAT_MAX_OUTPUT_TOKENS: process.env.CHAT_MAX_OUTPUT_TOKENS,
    RERANK_ENABLED: process.env.RERANK_ENABLED,
    RERANK_BASE_URL: process.env.RERANK_BASE_URL,
    RERANK_API_KEY: process.env.RERANK_API_KEY,
    RERANK_MODEL: process.env.RERANK_MODEL,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})

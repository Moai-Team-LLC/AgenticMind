// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

/**
 * Provider-agnostic AI settings (Agentic Product Standard — Layer 1: multi-provider
 * from the start). The default is a zero-key, offline, in-process multilingual
 * embedding model; chat defaults to OpenRouter for back-compat but accepts any
 * OpenAI-compatible endpoint (Ollama, OpenAI, vLLM, …).
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
    // `openrouter` is the back-compat default; `openai` is any OpenAI-compatible
    // endpoint (OpenAI, Ollama, vLLM, …) set via CHAT_BASE_URL.
    CHAT_PROVIDER: z.enum(["openrouter", "openai"]).default("openrouter"),
    CHAT_BASE_URL: z.url().optional(),
    CHAT_API_KEY: z.string().optional(),
    // Tiered routing: cheap/fast model for simple lookups, flagship for complex.
    CHAT_MODEL_SIMPLE: z.string().min(1).default("google/gemini-3.1-flash-lite-preview"),
    CHAT_MODEL_COMPLEX: z.string().min(1).default("openai/gpt-5-mini"),

    // ── Rerank (optional cross-encoder, off by default) ─────────────────
    // When off, retrieval falls back to the fused vector+BM25 order (no extra
    // call, no key). Set "true" for the Cohere-via-OpenRouter cross-encoder.
    RERANK_ENABLED: z.string().optional(),
  },
  runtimeEnv: {
    EMBED_PROVIDER: process.env.EMBED_PROVIDER,
    EMBED_MODEL: process.env.EMBED_MODEL,
    EMBED_POOLING: process.env.EMBED_POOLING,
    EMBED_BASE_URL: process.env.EMBED_BASE_URL,
    EMBED_API_KEY: process.env.EMBED_API_KEY,
    EMBED_HF_ENDPOINT: process.env.EMBED_HF_ENDPOINT,
    EMBED_CACHE_DIR: process.env.EMBED_CACHE_DIR,
    CHAT_PROVIDER: process.env.CHAT_PROVIDER,
    CHAT_BASE_URL: process.env.CHAT_BASE_URL,
    CHAT_API_KEY: process.env.CHAT_API_KEY,
    CHAT_MODEL_SIMPLE: process.env.CHAT_MODEL_SIMPLE,
    CHAT_MODEL_COMPLEX: process.env.CHAT_MODEL_COMPLEX,
    RERANK_ENABLED: process.env.RERANK_ENABLED,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})

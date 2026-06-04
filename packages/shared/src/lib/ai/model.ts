import * as z from "zod"

// A chat model identifier. Kept as a free-form string (not an enum) so any
// provider's model ids work — OpenRouter slugs, OpenAI names, or local Ollama
// tags — per the Agentic Product Standard's "multi-provider from the start".
const llmModel = z.string().min(1)

type LlmModel = z.infer<typeof llmModel>

const embeddingModel = z.enum(["openai/text-embedding-3-large", "openai/text-embedding-3-small"])

type EmbeddingModel = z.infer<typeof embeddingModel>

// Free-form so any reranker id works — native Cohere (`rerank-v3.5`,
// `rerank-multilingual-v3.0`, …) or whatever your RERANK_BASE_URL accepts.
const rerankModel = z.string().min(1)

type RerankModel = z.infer<typeof rerankModel>

export {
  llmModel,
  type LlmModel,
  embeddingModel,
  type EmbeddingModel,
  rerankModel,
  type RerankModel,
}

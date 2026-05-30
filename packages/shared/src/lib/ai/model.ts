import * as z from "zod"

const llmModel = z.enum(["openai/gpt-5-mini", "google/gemini-3.1-flash-lite-preview"])

type LlmModel = z.infer<typeof llmModel>

const embeddingModel = z.enum(["openai/text-embedding-3-large", "openai/text-embedding-3-small"])

type EmbeddingModel = z.infer<typeof embeddingModel>

const rerankModel = z.enum(["cohere/rerank-v3.5", "cohere/rerank-4-pro", "cohere/rerank-4-fast"])

type RerankModel = z.infer<typeof rerankModel>

export {
  llmModel,
  type LlmModel,
  embeddingModel,
  type EmbeddingModel,
  rerankModel,
  type RerankModel,
}

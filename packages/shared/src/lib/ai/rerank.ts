import type { RerankModel } from "@agenticmind/shared/lib/ai/model"

import { buildRetryOptions } from "@agenticmind/shared/lib/retry"
import { parseZodSchema } from "@agenticmind/shared/lib/zod/parse"
import { aiSettings } from "@agenticmind/shared/settings/ai-settings"
import { ResultAsync } from "neverthrow"
import pRetry from "p-retry"
import * as z from "zod"

// Native Cohere /v2/rerank by default (OpenRouter previously just proxied this
// identical shape). Point RERANK_BASE_URL at any Cohere-compatible endpoint.
const DEFAULT_RERANK_URL = "https://api.cohere.com/v2/rerank"

const rerankResponseSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      relevance_score: z.number(),
    }),
  ),
})

type RerankRanking = readonly { originalIndex: number; score: number }[]

const rerankDocuments = (props: {
  model: RerankModel
  documents: string[]
  query: string
  topN?: number
  purpose: string
}) =>
  ResultAsync.fromPromise(
    pRetry(
      async () => {
        const response = await fetch(aiSettings.RERANK_BASE_URL ?? DEFAULT_RERANK_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aiSettings.RERANK_API_KEY ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: props.model,
            query: props.query,
            documents: props.documents,
            top_n: props.topN,
          }),
        })

        if (!response.ok) {
          throw new Error(`rerank ${response.status}: ${await response.text()}`)
        }

        const raw: unknown = await response.json()
        return raw
      },
      {
        ...buildRetryOptions(props.purpose),
      },
    ),
    (error) => {
      return {
        type: "ai_error",
        message: `Failed to rerank documents for ${props.purpose}`,
        originalError: error,
      }
    },
  )
    .andThen((raw) => parseZodSchema(rerankResponseSchema, raw))
    .map(
      (parsed): RerankRanking =>
        parsed.results.map((result) => {
          return {
            originalIndex: result.index,
            score: result.relevance_score,
          }
        }),
    )

export { type RerankRanking, rerankDocuments }

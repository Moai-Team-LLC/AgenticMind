/**
 * Query planner — ported from services/knowledge/internal/qaplan/planner.go.
 * Converts an NL question into a typed graphrag.MultiHopSpec (or "not
 * applicable" for narrative questions), runs the multi-hop, and formats result
 * paths as synth graph-context rows. parsePlannerResponse + formatRows are
 * pure (ontology only) and unit-tested; the LLM + Neo4j calls are wired in
 * createGraphContextProvider. Gated behind KNOWLEDGE_QAPLAN_ENABLED.
 */

import type { LlmModel } from "@agenticmind/shared/lib/ai/model"
import type { GraphStore } from "@agenticmind/shared/lib/knowledge/graph-store"
import type { Hop, MultiHopResult, MultiHopSpec } from "@agenticmind/shared/lib/knowledge/graphrag"
import type { GraphContextRow } from "@agenticmind/shared/lib/knowledge/synth"

import {
  isValidPredicate,
  isValidSubjectType,
  listPredicates,
  listTypes,
} from "@agenticmind/shared/lib/knowledge/ontology"
import { okAsync, ResultAsync } from "neverthrow"
import * as z from "zod"

const PLANNER_SYSTEM_PROMPT_TEMPLATE = `You are a query-shape classifier for a private community knowledge service.

Your job: decide whether the user's question can be answered by a
multi-hop traversal over a typed knowledge graph, and if so, emit a
structured query specification.

The graph has typed entities and predicates from a fixed V0 ontology.
You may NOT introduce new types or predicates — the runtime will reject
any spec that uses unknown values.

Allowed entity types (also valid as start_type / target_type):
{{types}}

Allowed predicates (use only these in hop.predicate):
{{predicates}}

Respond with ONLY a JSON object — no markdown fences, no preamble.

Shape A — when the question doesn't fit a typed multi-hop:
{ "applicable": false, "reason": "<one short sentence>" }

Shape B — when the question does fit:
{
  "applicable": true,
  "reason": "<one short sentence>",
  "spec": {
    "startType": "<ontology type>",
    "startName": "<canonical name or empty>",
    "hops": [{ "predicate": "<ontology predicate>", "targetType": "<ontology type>", "targetName": "<canonical name or empty>" }],
    "minConfidence": 0.0,
    "limit": 10
  }
}

Examples:
Q: "Who in the community works at Stripe?"
A: {"applicable":true,"reason":"single-hop Member→Company by name","spec":{"startType":"Member","hops":[{"predicate":"works_at","targetType":"Company","targetName":"Stripe"}],"limit":25}}
Q: "Which members work in fintech in Cyprus?"
A: {"applicable":true,"reason":"two predicates","spec":{"startType":"Member","hops":[{"predicate":"located_in","targetType":"Location","targetName":"Cyprus"},{"predicate":"focuses_on","targetType":"Industry","targetName":"fintech"}],"limit":25}}
Q: "Tell me about Alice's approach to product market fit."
A: {"applicable":false,"reason":"narrative answer, not a triple chain"}

Rules:
- "applicable" must be a literal boolean true/false.
- When applicable=false, omit the spec field.
- Use the ontology vocabulary verbatim — no synonyms, plurals, or case changes.
- If the question names a specific entity (e.g. "Stripe"), put it in the
  appropriate hop's targetName.`

/** Renders the ontology types + predicates into the planner system prompt. */
export const buildPlannerPrompt = (): string => {
  const types = listTypes()
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n")
  const predicates = listPredicates()
    .map((p) => `- ${p.name} — ${p.description}`)
    .join("\n")
  return PLANNER_SYSTEM_PROMPT_TEMPLATE.replace("{{types}}", types).replace(
    "{{predicates}}",
    predicates,
  )
}

export const rawPlanSchema = z.object({
  applicable: z.boolean(),
  reason: z.string().nullish(),
  spec: z
    .object({
      startType: z.string(),
      startName: z.string().nullish(),
      hops: z.array(
        z.object({
          predicate: z.string(),
          targetType: z.string(),
          targetName: z.string().nullish(),
        }),
      ),
      minConfidence: z.number().nullish(),
      limit: z.number().nullish(),
    })
    .nullish(),
})

export type RawPlan = z.infer<typeof rawPlanSchema>

export type PlanResult = {
  applicable: boolean
  reason: string
  spec?: MultiHopSpec
}

/** Validates a parsed planner response against the V0 ontology. Pure. */
export const parsePlannerResponse = (raw: RawPlan): PlanResult => {
  if (!raw.applicable) {
    return { applicable: false, reason: raw.reason ?? "" }
  }
  if (raw.spec === null || raw.spec === undefined) {
    return { applicable: false, reason: "applicable=true but spec missing" }
  }
  const spec = raw.spec
  if (!isValidSubjectType(spec.startType)) {
    return { applicable: false, reason: `unknown startType "${spec.startType}"` }
  }
  const hops: Hop[] = []
  for (let i = 0; i < spec.hops.length; i++) {
    const rh = spec.hops[i]
    if (rh === undefined) {
      continue
    }
    if (!isValidPredicate(rh.predicate)) {
      return { applicable: false, reason: `hops[${i}] unknown predicate "${rh.predicate}"` }
    }
    if (!isValidSubjectType(rh.targetType)) {
      return { applicable: false, reason: `hops[${i}] unknown targetType "${rh.targetType}"` }
    }
    hops.push({
      predicate: rh.predicate,
      targetType: rh.targetType,
      targetName: (rh.targetName ?? "").trim(),
    })
  }
  let limit = spec.limit ?? 25
  if (limit <= 0) {
    limit = 25
  }
  if (limit > 200) {
    limit = 200
  }
  return {
    applicable: true,
    reason: raw.reason ?? "",
    spec: {
      startType: spec.startType,
      startName: (spec.startName ?? "").trim(),
      hops,
      minConfidence: spec.minConfidence ?? 0,
      limit,
    },
  }
}

/** Formats multi-hop result paths as arrow-chain graph-context rows. Pure. */
export const formatRows = (rows: MultiHopResult[]): GraphContextRow[] => {
  const out: GraphContextRow[] = []
  for (const r of rows) {
    if (r.path.length === 0) {
      continue
    }
    const body = r.path
      .map((n) =>
        n.ontologyType !== "" ? `${n.canonicalName} (${n.ontologyType})` : n.canonicalName,
      )
      .join(" → ")
    out.push({ body, materialIds: [] })
  }
  return out
}

export type PlanError = { readonly type: string; readonly message: string }

/** Plans a question into a typed multi-hop spec via the LLM (lazy import). */
export const planQuestion = (props: {
  question: string
  chatModel?: LlmModel
}): ResultAsync<PlanResult, PlanError> => {
  const question = props.question.trim()
  if (question === "") {
    return okAsync<PlanResult, PlanError>({ applicable: false, reason: "empty question" })
  }
  return ResultAsync.fromPromise(
    import("@agenticmind/shared/lib/knowledge/llm"),
    (e): PlanError => {
      return { type: "import_error", message: String(e) }
    },
  ).andThen((m) =>
    m
      .completeKnowledgeJson({
        system: buildPlannerPrompt(),
        user: `Question: ${question}`,
        schema: rawPlanSchema,
        model: props.chatModel,
        purpose: "knowledge qaplan",
      })
      .map((raw) => parsePlannerResponse(raw))
      .mapErr((e): PlanError => {
        return { type: e.type, message: e.message }
      }),
  )
}

export const DEFAULT_PROVIDER_TTL_MS = 60_000

/**
 * Builds a graph-context provider for the /ask pipeline: plan → multi-hop →
 * format, with an in-memory TTL cache keyed on the normalised question.
 * Returns [] (never throws) when the question doesn't fit a multi-hop or the
 * graph query fails — graph context is supplementary.
 */
export const createGraphContextProvider = (deps: {
  repo: GraphStore
  chatModel?: LlmModel
  ttlMs?: number
}): ((question: string, queryEmbedding: number[]) => Promise<GraphContextRow[]>) => {
  const ttl = deps.ttlMs !== undefined && deps.ttlMs > 0 ? deps.ttlMs : DEFAULT_PROVIDER_TTL_MS
  const cache = new Map<string, { rows: GraphContextRow[]; expiresAt: number }>()
  const key = (q: string) => q.trim().toLowerCase()

  return async (question: string): Promise<GraphContextRow[]> => {
    const k = key(question)
    const hit = cache.get(k)
    if (hit !== undefined && Date.now() < hit.expiresAt) {
      return hit.rows
    }

    const planned = await planQuestion({ question, chatModel: deps.chatModel })
    if (planned.isErr() || !planned.value.applicable || planned.value.spec === undefined) {
      cache.set(k, { rows: [], expiresAt: Date.now() + ttl })
      return []
    }
    const queryResult = await deps.repo.multiHopQuery(planned.value.spec)
    if (queryResult.isErr()) {
      return []
    }
    const rows = formatRows(queryResult.value)
    cache.set(k, { rows, expiresAt: Date.now() + ttl })
    return rows
  }
}

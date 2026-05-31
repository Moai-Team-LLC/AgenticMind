/**
 * GraphRAG LLM extractor — ported from
 * services/knowledge/internal/graphrag/extract.go. Sends material text to the
 * chat model (JSON mode) and parses entities + relations, normalising entity
 * ids, mapping free-form types/predicates onto the V0 ontology, and dropping
 * relations whose endpoints don't resolve. parseExtraction is pure (ontology
 * only) and unit-tested; the LLM call imports the client lazily.
 */

import type { ExtractedGraph, Relation } from "@agenticmind/shared/lib/knowledge/graphrag"

import {
  CURRENT_EXTRACTOR_VERSION,
  GRAPHRAG_MAX_BODY_CHARS,
  normalizeEntity,
} from "@agenticmind/shared/lib/knowledge/graphrag"
import { mapFreeFormPredicate, mapFreeFormType } from "@agenticmind/shared/lib/knowledge/ontology"
import { okAsync, ResultAsync } from "neverthrow"
import * as z from "zod"

export const EXTRACTION_SYSTEM_PROMPT = `You extract a knowledge graph from one document for a private community
knowledge base. Identify the salient entities (concepts, frameworks,
companies, technologies, people) and the explicit relationships between
them. Be conservative: only include entities the document discusses
substantively, not passing mentions.

Respond with ONLY a JSON object — no markdown, no prose, no preamble.
The shape is:

{
  "entities": [
    {
      "name": "<canonical name>",
      "type": "concept" | "framework" | "company" | "technology" | "person",
      "aliases": ["<alternate spelling>", ...],
      "confidence": 0.0..1.0
    }
  ],
  "relations": [
    {
      "from": "<canonical name>",
      "to":   "<canonical name>",
      "predicate": "<short verb phrase, e.g. 'uses', 'developed_by', 'competes_with'>",
      "confidence": 0.0..1.0
    }
  ]
}

Rules:
- Use the canonical name (Title Case, the most natural English form)
  even if the document mostly uses an alias. Put the alternate forms in
  "aliases".
- "from" and "to" in relations MUST refer to canonical names that appear
  in "entities" — never invent a third entity in relations.
- Cap output at 25 entities and 25 relations. Pick the most informative ones.
- If the document is too short or off-topic to extract anything useful,
  return {"entities":[],"relations":[]}.`

export const rawGraphSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.string().nullish(),
      aliases: z.array(z.string()).nullish(),
      confidence: z.number().nullish(),
    }),
  ),
  relations: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      predicate: z.string().nullish(),
      confidence: z.number().nullish(),
    }),
  ),
})

export type RawGraph = z.infer<typeof rawGraphSchema>

const clamp01 = (v: number): number => (v < 0 ? 0 : Math.min(1, v))

/**
 * Parses a model graph response into a normalised ExtractedGraph: entities get
 * deterministic ids + V0 ontology-type annotations; relations resolve by
 * canonical name or alias (unresolved/self-edges dropped) and carry the
 * mapped V0 predicate when available. Pure — no LLM, no Neo4j.
 */
export const parseExtraction = (raw: RawGraph): ExtractedGraph => {
  const graph: ExtractedGraph = {
    materialId: "",
    entities: [],
    relations: [],
    extractorVersion: CURRENT_EXTRACTOR_VERSION,
  }
  const byName = new Map<string, string>()

  for (const re of raw.entities) {
    const ent = normalizeEntity({
      canonicalName: re.name,
      type: re.type ?? undefined,
      aliases: re.aliases ?? undefined,
      confidence: re.confidence ?? undefined,
    })
    if (ent === null) {
      continue
    }
    const mapped = mapFreeFormType(ent.type)
    if (mapped !== undefined) {
      ent.ontologyType = mapped
    }
    byName.set(re.name.trim().toLowerCase(), ent.entityId)
    for (const alias of ent.aliases) {
      byName.set(alias.trim().toLowerCase(), ent.entityId)
    }
    graph.entities.push(ent)
  }

  for (const rr of raw.relations) {
    const fromId = byName.get(rr.from.trim().toLowerCase())
    const toId = byName.get(rr.to.trim().toLowerCase())
    if (fromId === undefined || toId === undefined) {
      continue
    }
    if (fromId === toId) {
      continue
    }
    const predicate = (rr.predicate ?? "").trim() || "related_to"
    const relation: Relation = {
      from: fromId,
      to: toId,
      predicate,
      ontologyPredicate: mapFreeFormPredicate(predicate) ?? "",
      confidence: clamp01(rr.confidence ?? 0),
    }
    graph.relations.push(relation)
  }
  return graph
}

const buildUserPrompt = (title: string, body: string): string => {
  const runes = Array.from(body)
  const truncated =
    runes.length > GRAPHRAG_MAX_BODY_CHARS
      ? `${runes.slice(0, GRAPHRAG_MAX_BODY_CHARS).join("")}\n[…truncated…]`
      : body
  const titleLine = title !== "" ? `Title: ${title}\n\n` : ""
  return `${titleLine}Document:\n${truncated}`
}

export type GraphExtractError = { readonly type: string; readonly message: string }

/**
 * Extracts a knowledge graph from material text via the LLM. Empty body → an
 * empty graph. materialId is stamped by the caller. llm imported lazily.
 */
export const extractGraph = (props: {
  materialId: string
  materialTitle: string
  body: string
}): ResultAsync<ExtractedGraph, GraphExtractError> => {
  const body = props.body.trim()
  const empty: ExtractedGraph = {
    materialId: props.materialId,
    entities: [],
    relations: [],
    extractorVersion: CURRENT_EXTRACTOR_VERSION,
  }
  if (body === "") {
    return okAsync<ExtractedGraph, GraphExtractError>(empty)
  }
  return ResultAsync.fromPromise(
    import("@agenticmind/shared/lib/knowledge/llm"),
    (e): GraphExtractError => {
      return { type: "import_error", message: String(e) }
    },
  ).andThen((m) =>
    m
      .completeKnowledgeJson({
        system: EXTRACTION_SYSTEM_PROMPT,
        user: buildUserPrompt(props.materialTitle, body),
        schema: rawGraphSchema,
        purpose: "knowledge graphrag extraction",
      })
      .map((raw) => {
        return { ...parseExtraction(raw), materialId: props.materialId }
      })
      .mapErr((e): GraphExtractError => {
        return { type: e.type, message: e.message }
      }),
  )
}

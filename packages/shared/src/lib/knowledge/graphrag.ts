/**
 * GraphRAG core types + deterministic entity identity — ported from
 * services/knowledge/internal/graphrag/graphrag.go. The Layer-2 knowledge
 * graph (Neo4j) sits on top of vector retrieval: an LLM extracts entities +
 * relations from each material. Entity identity is content-derived so
 * re-extraction converges instead of duplicating nodes. This module is pure
 * (no Neo4j/LLM) — the repo and extractor live in sibling files.
 */

import { createHash } from "node:crypto"

export const CURRENT_EXTRACTOR_VERSION = "v1"
/** Max material text sent to the extractor. */
export const GRAPHRAG_MAX_BODY_CHARS = 16_000
/** LLM extraction timeout. */
export const GRAPHRAG_TIMEOUT_MS = 60_000

export type Entity = {
  /** Sha1(canonical_name|type) truncated to 32 hex chars — deterministic. */
  entityId: string
  canonicalName: string
  /** Free-form lowercase type (concept|company|person|technology|…). */
  type: string
  /** Mapped V0 ontology type (Member/Company/Skill/…) or "" when not in V0. */
  ontologyType: string
  aliases: string[]
  confidence: number
}

export type Relation = {
  from: string
  to: string
  /** Raw extractor predicate, kept verbatim. */
  predicate: string
  /** Canonicalised V0 predicate, or "" when no mapping. */
  ontologyPredicate: string
  confidence: number
}

export type ExtractedGraph = {
  materialId: string
  entities: Entity[]
  relations: Relation[]
  extractorVersion: string
}

export const isGraphEmpty = (g: ExtractedGraph | null): boolean =>
  g === null || (g.entities.length === 0 && g.relations.length === 0)

export type Neighbor = {
  materialId: string
  title: string
  entity: Entity
  /** 1 = direct mention, 2 = via a related entity. */
  distance: number
}

export type Hop = {
  predicate: string
  /** Ontology_type required on the target entity. */
  targetType: string
  /** Optional canonical_name filter; "" matches any. */
  targetName: string
}

export type MultiHopSpec = {
  startType: string
  startName?: string
  hops: Hop[]
  minConfidence?: number
  limit?: number
}

export type HopNode = {
  entityId: string
  canonicalName: string
  ontologyType: string
  confidence: number
}

export type MultiHopResult = { path: HopNode[] }

/**
 * Normalises (canonicalName, type) into a stable 32-hex id. Lowercase +
 * whitespace-collapse + trim mean "GPT-4 mini", " GPT-4 MINI " and
 * "gpt-4 mini" all map to the same id. Mirrors the Go sha1[:16] → 32 hex.
 */
export const canonicalEntityId = (canonicalName: string, entityType: string): string => {
  const name = canonicalName
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((w) => w !== "")
    .join(" ")
  const t = entityType.trim().toLowerCase() || "concept"
  return createHash("sha1").update(`${name}|${t}`).digest("hex").slice(0, 32)
}

export type RawEntity = {
  canonicalName: string
  type?: string
  ontologyType?: string
  aliases?: string[]
  confidence?: number
}

/**
 * Fills in entityId + normalises type/aliases/confidence. Returns null when
 * the entity is unusable (blank canonical name) so the caller can skip it.
 */
export const normalizeEntity = (e: RawEntity): Entity | null => {
  const canonicalName = e.canonicalName.trim()
  if (canonicalName === "") {
    return null
  }
  const type = (e.type ?? "").trim().toLowerCase() || "concept"

  const seen = new Set<string>([canonicalName.toLowerCase()])
  const aliases: string[] = []
  for (const raw of e.aliases ?? []) {
    const a = raw.trim()
    if (a === "") {
      continue
    }
    const lk = a.toLowerCase()
    if (seen.has(lk)) {
      continue
    }
    seen.add(lk)
    aliases.push(a)
  }

  let confidence = e.confidence ?? 0
  if (confidence < 0) {
    confidence = 0
  }
  if (confidence > 1) {
    confidence = 1
  }

  return {
    entityId: canonicalEntityId(canonicalName, type),
    canonicalName,
    type,
    ontologyType: e.ontologyType ?? "",
    aliases,
    confidence,
  }
}

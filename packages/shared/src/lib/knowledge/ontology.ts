/**
 * Ontology V0 — typed-card schema with validation and free-form mapping.
 *
 * Ported from services/knowledge/internal/ontology (ontology.go +
 * confidence.go). The cards extractor uses validateTriple to drop unknown
 * subject_types / predicates before write; graphrag/qaplan use the free-form
 * mappers to canonicalise LLM drift onto the frozen V0 vocabulary.
 */

import type { EntityType, Predicate } from "@agenticmind/shared/lib/knowledge/ontology-data"

import {
  ENTITY_TYPES,
  FREE_FORM_PREDICATE_MAP,
  FREE_FORM_TYPE_MAP,
  ONTOLOGY_FROZEN_AT,
  ONTOLOGY_VERSION,
  PREDICATES,
} from "@agenticmind/shared/lib/knowledge/ontology-data"

// --- confidence cutoffs (ontology/confidence.go) ---

/** Floor for cards considered during search and the /ask hybrid pool. */
export const RETRIEVAL_MIN_CONFIDENCE = 0.5
/** Floor for cards eligible as a structured answer without LLM synthesis. */
export const STRUCTURED_ANSWER_MIN_CONFIDENCE = 0.8
/** Hybrid-blend multiplier applied to card hits sharing the chunk pool. */
export const CARD_WEIGHT_BOOST = 1.3

export type Schema = {
  version: string
  frozenAt: string
  types: ReadonlyMap<string, EntityType>
  predicates: ReadonlyMap<string, Predicate>
  /** Declaration order (stable across boots; safe for admin UI). */
  typeOrder: readonly string[]
  predicateOrder: readonly string[]
}

/**
 * Builds the schema and runs the same cross-reference consistency checks the
 * Go Load() does: unique names, and every predicate subject/object type must
 * reference a known entity type. Throws on inconsistency (build-time bug).
 */
const buildSchema = (entityTypes: readonly EntityType[], preds: readonly Predicate[]): Schema => {
  const types = new Map<string, EntityType>()
  const typeOrder: string[] = []
  for (const t of entityTypes) {
    if (t.name === "") {
      throw new Error("ontology: type with empty name")
    }
    if (types.has(t.name)) {
      throw new Error(`ontology: duplicate type "${t.name}"`)
    }
    types.set(t.name, t)
    typeOrder.push(t.name)
  }

  const predicates = new Map<string, Predicate>()
  const predicateOrder: string[] = []
  for (const p of preds) {
    if (p.name === "") {
      throw new Error("ontology: predicate with empty name")
    }
    if (predicates.has(p.name)) {
      throw new Error(`ontology: duplicate predicate "${p.name}"`)
    }
    for (const st of p.subjectTypes) {
      if (!types.has(st)) {
        throw new Error(`ontology: predicate "${p.name}" references unknown subject_type "${st}"`)
      }
    }
    if (p.objectKind === "entity") {
      if (p.objectTypes.length === 0) {
        throw new Error(
          `ontology: predicate "${p.name}" is object_kind=entity but has no object_types`,
        )
      }
      for (const ot of p.objectTypes) {
        if (!types.has(ot)) {
          throw new Error(`ontology: predicate "${p.name}" references unknown object_type "${ot}"`)
        }
      }
    }
    predicates.set(p.name, p)
    predicateOrder.push(p.name)
  }

  return {
    version: ONTOLOGY_VERSION,
    frozenAt: ONTOLOGY_FROZEN_AT,
    types,
    predicates,
    typeOrder,
    predicateOrder,
  }
}

/** The frozen V0 ontology singleton (equivalent to MustLoadEmbedded). */
export const ontologyV0: Schema = buildSchema(ENTITY_TYPES, PREDICATES)

export const isValidSubjectType = (name: string): boolean => ontologyV0.types.has(name)
export const isValidPredicate = (name: string): boolean => ontologyV0.predicates.has(name)
export const getPredicate = (name: string): Predicate | undefined => ontologyV0.predicates.get(name)
export const getType = (name: string): EntityType | undefined => ontologyV0.types.get(name)
export const listTypes = (): EntityType[] =>
  ontologyV0.typeOrder
    .map((n) => ontologyV0.types.get(n))
    .filter((t): t is EntityType => t !== undefined)
export const listPredicates = (): Predicate[] =>
  ontologyV0.predicateOrder
    .map((n) => ontologyV0.predicates.get(n))
    .filter((p): p is Predicate => p !== undefined)

/**
 * Validates that (subjectType, predicate, objectType) is a well-formed V0
 * triple. Returns an error message string on failure (so the extractor can
 * log + drop without throwing), or null when valid.
 */
export const validateTriple = (
  subjectType: string,
  predicate: string,
  objectType: string,
): string | null => {
  if (!isValidSubjectType(subjectType)) {
    return `ontology: unknown subject_type "${subjectType}"`
  }
  const p = ontologyV0.predicates.get(predicate)
  if (p === undefined) {
    return `ontology: unknown predicate "${predicate}"`
  }
  if (!p.subjectTypes.includes(subjectType)) {
    return `ontology: predicate "${predicate}" does not accept subject_type "${subjectType}" (allowed: ${p.subjectTypes.join(",")})`
  }
  if (p.objectKind === "entity") {
    if (!isValidSubjectType(objectType)) {
      return `ontology: unknown object_type "${objectType}" for predicate "${predicate}"`
    }
    if (!p.objectTypes.includes(objectType)) {
      return `ontology: predicate "${predicate}" does not accept object_type "${objectType}" (allowed: ${p.objectTypes.join(",")})`
    }
  }
  return null
}

/**
 * Canonicalises a raw predicate string for lookup: lowercased, surrounding
 * punctuation trimmed, whitespace/dash runs collapsed to a single "_".
 * "works for", "works-for", "WORKS FOR" all collapse to "works_for".
 */
export const normalisePredicate = (raw: string): string => {
  let clean = raw.trim().toLowerCase()
  clean = clean.replaceAll(/^[[\](),.;:!?]+|[[\](),.;:!?]+$/g, "")
  if (clean === "") {
    return ""
  }
  let out = ""
  let prevWasSep = false
  for (const r of clean) {
    if (r === " " || r === "\t" || r === "-" || r === "_") {
      if (!prevWasSep) {
        out += "_"
        prevWasSep = true
      }
      continue
    }
    out += r
    prevWasSep = false
  }
  return out.replaceAll(/^_+|_+$/g, "")
}

/**
 * Canonicalises a free-form entity-type string to a V0 type. Tries the exact
 * ontology type (case-insensitive) first, then the legacy alias map. Returns
 * undefined on any miss so callers don't assign a default that hides bad data.
 */
export const mapFreeFormType = (raw: string): string | undefined => {
  const clean = raw.trim()
  if (clean === "") {
    return undefined
  }
  for (const name of ontologyV0.types.keys()) {
    if (name.toLowerCase() === clean.toLowerCase()) {
      return name
    }
  }
  const mapped = FREE_FORM_TYPE_MAP[clean.toLowerCase()]
  if (mapped !== undefined && ontologyV0.types.has(mapped)) {
    return mapped
  }
  return undefined
}

/**
 * Canonicalises a free-form predicate string to a V0 predicate. Direct match
 * (case-insensitive) first so re-running on typed extractions is idempotent,
 * then the alias map. Returns undefined on any miss — callers keep the raw
 * predicate so multi-hop queries still work during rollout.
 */
export const mapFreeFormPredicate = (raw: string): string | undefined => {
  const clean = normalisePredicate(raw)
  if (clean === "") {
    return undefined
  }
  for (const name of ontologyV0.predicates.keys()) {
    if (name.toLowerCase() === clean.toLowerCase()) {
      return name
    }
  }
  const mapped = FREE_FORM_PREDICATE_MAP[clean]
  if (mapped !== undefined && ontologyV0.predicates.has(mapped)) {
    return mapped
  }
  return undefined
}

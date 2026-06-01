/**
 * Backend-agnostic GraphRAG store interface. The implementation is Postgres
 * (`graphrag-postgres.ts`, recursive-CTE traversal). Callers (qaplan,
 * mcp-tools, ingestion) depend only on this interface; a different backend can
 * be dropped in later without touching them.
 */

import type {
  Entity,
  ExtractedGraph,
  MultiHopResult,
  MultiHopSpec,
  Neighbor,
} from "@agenticmind/shared/lib/knowledge/graphrag"
import type { ResultAsync } from "neverthrow"

/**
 * Common error shape. Concrete backends use a more specific `type`
 * (`"neo4j_error"`, `"pg_graph_error"`) that remains assignable here.
 */
export type GraphError = { readonly type: string; readonly message: string }

export type GraphStore = {
  /** Idempotent DDL/constraint setup. No-op when migrations own the schema. */
  ensureSchema(): ResultAsync<void, GraphError>
  /** Persist one material's extracted entities + relations idempotently. */
  upsertExtraction(graph: ExtractedGraph): ResultAsync<void, GraphError>
  /** Entities a material mentions, ordered by canonical name. */
  entitiesForMaterial(materialId: string): ResultAsync<Entity[], GraphError>
  /** Other materials sharing a mentioned entity, ranked by shared count. */
  neighbors(materialId: string, limit?: number): ResultAsync<Neighbor[], GraphError>
  /** Typed multi-hop traversal over RELATED edges from a start entity type. */
  multiHopQuery(spec: MultiHopSpec): ResultAsync<MultiHopResult[], GraphError>
  /** Release backend resources. No-op for a pooled Postgres store. */
  close(): ResultAsync<void, GraphError>
}

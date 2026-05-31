/**
 * Pgvector helpers for the knowledge retrieval layer. Pure (no env / network)
 * so it can be imported by the hybrid-search SQL builders and unit-tested
 * without pulling in the AI client.
 */

/**
 * Renders an embedding as a pgvector text literal (`[0.1,0.2,...]`) for raw
 * SQL `::vector` casts. Mirrors the Go `vectorLiteral` helper — pgvector
 * accepts no binary codec over the wire, so the query path passes a string.
 */
export const toVectorLiteral = (embedding: readonly number[]): string => `[${embedding.join(",")}]`

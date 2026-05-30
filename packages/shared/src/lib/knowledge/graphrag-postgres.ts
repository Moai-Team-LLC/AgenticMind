/**
 * Postgres-backed GraphStore — the flagship GraphRAG backend. Mirrors the Neo4j
 * model on three tables (kg_entities / kg_mentions / kg_relations) and serves
 * neighbour + typed multi-hop traversal with SQL (aggregate co-mention ranking
 * and a dynamically-shaped, fully-parameterised join chain). Entity/material
 * writes are atomic in one transaction, so the graph never drifts from the
 * trace/cards it is cited alongside — the consistency the async Neo4j mirror
 * (now removed) could not guarantee.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { GraphError, GraphStore } from "@agenticmind/shared/lib/knowledge/graph-store"
import type {
  Entity,
  ExtractedGraph,
  MultiHopResult,
  MultiHopSpec,
  Neighbor,
} from "@agenticmind/shared/lib/knowledge/graphrag"

import {
  kgEntities,
  kgMentions,
  kgRelations,
} from "@agenticmind/shared/database/schema/knowledge/graph"
import { asc, eq, sql, type SQL } from "drizzle-orm"
import { ResultAsync, okAsync } from "neverthrow"

const pgGraphError = (message: string): GraphError => ({ type: "pg_graph_error", message })

const nullIfEmpty = (s: string): string | null => (s === "" ? null : s)

const wrap = <T>(fn: () => Promise<T>): ResultAsync<T, GraphError> =>
  ResultAsync.fromPromise(fn(), (e) => pgGraphError(e instanceof Error ? e.message : String(e)))

/**
 * Builds the multi-hop SELECT. Only the hop *count* and the structural aliases
 * (n0, r1, …) are interpolated via `sql.raw` — they derive from the typed spec,
 * never from user input. Every value is a bound parameter. Mirrors the Neo4j
 * `buildMultiHopCypher`.
 */
const buildMultiHopSql = (spec: MultiHopSpec, limit: number): SQL => {
  const minConf = spec.minConfidence ?? 0

  const conds: SQL[] = [sql`n0.ontology_type = ${spec.startType}`]
  if (spec.startName !== undefined && spec.startName !== "") {
    conds.push(sql`n0.canonical_name = ${spec.startName}`)
  }
  if (minConf > 0) conds.push(sql`n0.confidence >= ${minConf}`)

  const joins: SQL[] = []
  spec.hops.forEach((h, idx) => {
    const r = idx + 1
    joins.push(
      sql.raw(
        `JOIN kg_relations r${r} ON r${r}.from_entity = n${idx}.entity_id ` +
          `JOIN kg_entities n${r} ON n${r}.entity_id = r${r}.to_entity`,
      ),
    )
    conds.push(
      sql`(${sql.raw(`r${r}.ontology_predicate`)} = ${h.predicate} OR (${sql.raw(`r${r}.ontology_predicate`)} IS NULL AND ${sql.raw(`r${r}.predicate`)} = ${h.predicate}))`,
    )
    conds.push(sql`${sql.raw(`n${r}.ontology_type`)} = ${h.targetType}`)
    if (h.targetName !== "") conds.push(sql`${sql.raw(`n${r}.canonical_name`)} = ${h.targetName}`)
    if (minConf > 0) conds.push(sql`${sql.raw(`n${r}.confidence`)} >= ${minConf}`)
  })

  const pathLen = spec.hops.length + 1
  const idCols: string[] = []
  const nameCols: string[] = []
  const typeCols: string[] = []
  const confCols: string[] = []
  for (let i = 0; i < pathLen; i++) {
    idCols.push(`n${i}.entity_id`)
    nameCols.push(`n${i}.canonical_name`)
    typeCols.push(`coalesce(n${i}.ontology_type, '')`)
    confCols.push(`coalesce(n${i}.confidence, 0)`)
  }

  const joinSql = joins.length > 0 ? sql.join(joins, sql` `) : sql``
  return sql`
    SELECT
      array[${sql.raw(idCols.join(", "))}] AS ids,
      array[${sql.raw(nameCols.join(", "))}] AS names,
      array[${sql.raw(typeCols.join(", "))}] AS types,
      array[${sql.raw(confCols.join(", "))}] AS confs
    FROM kg_entities n0
    ${joinSql}
    WHERE ${sql.join(conds, sql` AND `)}
    LIMIT ${limit}`
}

export const createPostgresGraphStore = (db: Transaction): GraphStore => {
  const ensureSchema = () => okAsync<void, GraphError>(undefined)

  const upsertExtraction = (graph: ExtractedGraph) =>
    wrap(async () => {
      if (graph.materialId === "") throw new Error("nil graph or zero material id")
      const now = new Date()
      const entityIds = new Set(graph.entities.map((e) => e.entityId))

      await db.transaction(async (tx) => {
        // Re-extraction replaces this material's mentions wholesale.
        await tx.delete(kgMentions).where(eq(kgMentions.materialId, graph.materialId))

        for (const e of graph.entities) {
          await tx
            .insert(kgEntities)
            .values({
              entityId: e.entityId,
              canonicalName: e.canonicalName,
              type: e.type,
              ontologyType: nullIfEmpty(e.ontologyType),
              aliases: e.aliases,
              confidence: e.confidence,
              extractorVersion: graph.extractorVersion,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: kgEntities.entityId,
              set: {
                canonicalName: e.canonicalName,
                type: e.type,
                ontologyType: nullIfEmpty(e.ontologyType),
                aliases: e.aliases,
                confidence: e.confidence,
                extractorVersion: graph.extractorVersion,
                updatedAt: now,
              },
            })

          await tx
            .insert(kgMentions)
            .values({
              materialId: graph.materialId,
              entityId: e.entityId,
              confidence: e.confidence,
              extractorVersion: graph.extractorVersion,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [kgMentions.materialId, kgMentions.entityId],
              set: {
                confidence: e.confidence,
                extractorVersion: graph.extractorVersion,
                updatedAt: now,
              },
            })
        }

        for (const rel of graph.relations) {
          // FK-safe: skip relations whose endpoints weren't extracted.
          if (!entityIds.has(rel.from) || !entityIds.has(rel.to)) continue
          await tx
            .insert(kgRelations)
            .values({
              fromEntity: rel.from,
              toEntity: rel.to,
              predicate: rel.predicate,
              ontologyPredicate: nullIfEmpty(rel.ontologyPredicate),
              confidence: rel.confidence,
              extractorVersion: graph.extractorVersion,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [kgRelations.fromEntity, kgRelations.toEntity, kgRelations.predicate],
              set: {
                ontologyPredicate: nullIfEmpty(rel.ontologyPredicate),
                confidence: rel.confidence,
                extractorVersion: graph.extractorVersion,
                updatedAt: now,
              },
            })
        }
      })
    })

  const entitiesForMaterial = (materialId: string) =>
    wrap(async (): Promise<Entity[]> => {
      const rows = await db
        .select({
          entityId: kgEntities.entityId,
          canonicalName: kgEntities.canonicalName,
          type: kgEntities.type,
          ontologyType: kgEntities.ontologyType,
          aliases: kgEntities.aliases,
          confidence: kgEntities.confidence,
        })
        .from(kgMentions)
        .innerJoin(kgEntities, eq(kgEntities.entityId, kgMentions.entityId))
        .where(eq(kgMentions.materialId, materialId))
        .orderBy(asc(kgEntities.canonicalName))

      return rows.map((r) => ({
        entityId: r.entityId,
        canonicalName: r.canonicalName,
        type: r.type,
        ontologyType: r.ontologyType ?? "",
        aliases: r.aliases ?? [],
        confidence: r.confidence,
      }))
    })

  const neighbors = (materialId: string, limit = 10) =>
    wrap(async (): Promise<Neighbor[]> => {
      const cap = limit > 0 ? limit : 10
      const res = await db.execute(sql`
        WITH seed AS (
          SELECT entity_id FROM kg_mentions WHERE material_id = ${materialId}::uuid
        ),
        ranked AS (
          SELECT
            m.material_id,
            count(*)::int AS shared_count,
            (array_agg(e.entity_id     ORDER BY e.canonical_name))[1] AS via_id,
            (array_agg(e.canonical_name ORDER BY e.canonical_name))[1] AS via_name,
            (array_agg(e.type           ORDER BY e.canonical_name))[1] AS via_type
          FROM kg_mentions m
          JOIN kg_entities e ON e.entity_id = m.entity_id
          WHERE m.entity_id IN (SELECT entity_id FROM seed)
            AND m.material_id <> ${materialId}::uuid
          GROUP BY m.material_id
        )
        SELECT r.material_id, r.via_id, r.via_name, r.via_type,
               coalesce(mat.title, '') AS title
        FROM ranked r
        LEFT JOIN materials mat ON mat.id = r.material_id
        ORDER BY r.shared_count DESC, r.via_name
        LIMIT ${cap}`)

      const rows = res.rows as Array<{
        material_id: string
        via_id: string
        via_name: string
        via_type: string
        title: string
      }>

      return rows.map((row) => ({
        materialId: row.material_id,
        title: row.title ?? "",
        entity: {
          entityId: row.via_id,
          canonicalName: row.via_name,
          type: row.via_type,
          ontologyType: "",
          aliases: [],
          confidence: 0,
        },
        distance: 1,
      }))
    })

  const multiHopQuery = (spec: MultiHopSpec) =>
    wrap(async (): Promise<MultiHopResult[]> => {
      if (spec.startType.trim() === "")
        throw new Error("invalid multi-hop spec: startType required")
      const limit = spec.limit !== undefined && spec.limit > 0 ? Math.min(spec.limit, 200) : 25
      const res = await db.execute(buildMultiHopSql(spec, limit))

      const rows = res.rows as Array<{
        ids: string[]
        names: string[]
        types: string[]
        confs: number[]
      }>

      return rows.map((row) => ({
        path: (row.ids ?? []).map((id, i) => ({
          entityId: id,
          canonicalName: row.names?.[i] ?? "",
          ontologyType: row.types?.[i] ?? "",
          confidence: Number(row.confs?.[i] ?? 0),
        })),
      }))
    })

  const close = () => okAsync<void, GraphError>(undefined)

  return { ensureSchema, upsertExtraction, entitiesForMaterial, neighbors, multiHopQuery, close }
}

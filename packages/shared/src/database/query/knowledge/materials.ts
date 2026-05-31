/**
 * Materials repository — ported from services/knowledge/internal/materials
 * (repo_pg.go). CRUD + status/source/metadata mutations + a pg_trgm
 * "did you mean" title suggester. Follows the repo's query-function
 * convention: `{ tx }` props, neverthrow ResultAsync, mapDatabaseError.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { MaterialSelect } from "@agenticmind/shared/database/schema"
import type { MaterialSource, MaterialStatus } from "@agenticmind/shared/lib/knowledge/material"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { materials } from "@agenticmind/shared/database/schema"
import { and, desc, eq, sql } from "drizzle-orm"
import { okAsync, ResultAsync } from "neverthrow"

export type CreateMaterialInput = {
  id?: string
  title: string
  source: MaterialSource
  mimeType?: string | null
  sizeBytes?: number | null
  storageUri?: string | null
  sourceUrl?: string | null
  createdBy?: string | null
}

export type MaterialSuggestion = {
  materialId: string
  title: string
  score: number
}

/** Inserts a material at status=ingesting. id is optional (DB allocates one). */
export const createMaterial = (props: { tx: Transaction; input: CreateMaterialInput }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [created] = await props.tx
        .insert(materials)
        .values({
          ...(props.input.id !== undefined ? { id: props.input.id } : {}),
          title: props.input.title,
          source: props.input.source,
          status: "ingesting",
          mimeType: props.input.mimeType ?? null,
          sizeBytes: props.input.sizeBytes ?? null,
          storageUri: props.input.storageUri ?? null,
          sourceUrl: props.input.sourceUrl ?? null,
          createdBy: props.input.createdBy ?? null,
        })
        .returning()
      return created ?? null
    })(),
    mapDatabaseError,
  )

/** Fetches one material by id, or null when missing. */
export const getMaterial = (props: { tx: Transaction; id: string }) =>
  ResultAsync.fromPromise(
    (async (): Promise<MaterialSelect | null> => {
      const [found] = await props.tx
        .select()
        .from(materials)
        .where(eq(materials.id, props.id))
        .limit(1)
      return found ?? null
    })(),
    mapDatabaseError,
  )

/** Lists materials newest-first, optionally filtered by source/status. */
export const listMaterials = (props: {
  tx: Transaction
  source?: MaterialSource
  status?: MaterialStatus
  limit?: number
  offset?: number
}) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 500 ? props.limit : 100
  const offset = props.offset !== undefined && props.offset >= 0 ? props.offset : 0
  const filters = [
    props.source !== undefined ? eq(materials.source, props.source) : undefined,
    props.status !== undefined ? eq(materials.status, props.status) : undefined,
  ].filter((f) => f !== undefined)
  return ResultAsync.fromPromise(
    props.tx
      .select()
      .from(materials)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(materials.createdAt))
      .limit(limit)
      .offset(offset),
    mapDatabaseError,
  )
}

/** Sets status (+ optional error message), touching updated_at. Returns the row or null. */
export const updateMaterialStatus = (props: {
  tx: Transaction
  id: string
  status: MaterialStatus
  errorMessage?: string | null
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const [updated] = await props.tx
        .update(materials)
        .set({
          status: props.status,
          errorMessage: props.errorMessage ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(materials.id, props.id))
        .returning()
      return updated ?? null
    })(),
    mapDatabaseError,
  )

/** Changes source + source URL (used by from-url after a manual upload). */
export const setMaterialSource = (props: {
  tx: Transaction
  id: string
  source: MaterialSource
  sourceUrl: string | null
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const [updated] = await props.tx
        .update(materials)
        .set({ source: props.source, sourceUrl: props.sourceUrl, updatedAt: sql`now()` })
        .where(eq(materials.id, props.id))
        .returning()
      return updated ?? null
    })(),
    mapDatabaseError,
  )

/** Replaces the JSONB metadata sidecar (null clears it), touching updated_at. */
export const setMaterialMetadata = (props: {
  tx: Transaction
  id: string
  metadata: Record<string, unknown> | null
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const [updated] = await props.tx
        .update(materials)
        .set({ metadata: props.metadata, updatedAt: sql`now()` })
        .where(eq(materials.id, props.id))
        .returning()
      return updated ?? null
    })(),
    mapDatabaseError,
  )

/** Deletes a material (chunks/cards cascade). Returns the deleted row or null. */
export const deleteMaterial = (props: { tx: Transaction; id: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [deleted] = await props.tx
        .delete(materials)
        .where(eq(materials.id, props.id))
        .returning()
      return deleted ?? null
    })(),
    mapDatabaseError,
  )

/**
 * Trigram-similar title suggestions for the "did you mean…" UI. Fails open to
 * an empty list (pg_trgm missing / query error) — it's a UX nicety, not
 * load-bearing.
 */
export const suggestMaterialsByTitle = (props: {
  tx: Transaction
  query: string
  limit?: number
}): ResultAsync<MaterialSuggestion[], never> => {
  if (props.query === "") {
    return okAsync([])
  }
  const limit = props.limit !== undefined && props.limit > 0 && props.limit <= 25 ? props.limit : 5
  const score = sql<number>`similarity(lower(${materials.title}), lower(${props.query}))`
  return ResultAsync.fromPromise(
    props.tx
      .select({ materialId: materials.id, title: materials.title, score })
      .from(materials)
      .where(sql`lower(${materials.title}) % lower(${props.query})`)
      .orderBy(desc(score))
      .limit(limit),
    (error) => error,
  ).orElse(() => okAsync([]))
}

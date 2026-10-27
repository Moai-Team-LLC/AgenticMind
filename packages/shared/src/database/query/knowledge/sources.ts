/**
 * Source registry repository (contract 1.11.0): sources by identity, their
 * revisions, and the current-revision pointer. Callers lock a source row
 * (`lockSourceByIdentity`) before deciding on a delivery, so two deliveries of
 * one source are decided one after the other. `{ tx }` props, neverthrow,
 * mapDatabaseError — the repo's query convention.
 */

import type { Transaction } from "@agenticmind/shared/database/client"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import {
  knowledgeCorpus,
  knowledgeSources,
  sourceEvents,
  sourceRevisions,
} from "@agenticmind/shared/database/schema"
import { currentTenantId } from "@agenticmind/shared/database/schema/knowledge/_tenant"
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type SourceIdentity = { connectionId: string; sourceType: string; externalId: string }

/** The source with this identity, row-locked for the rest of the transaction, or null. */
export const lockSourceByIdentity = (props: { tx: Transaction; identity: SourceIdentity }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(knowledgeSources)
        .where(
          and(
            // Identity is unique per tenant: name it, RLS alone is bypassed by an owner.
            eq(knowledgeSources.tenantId, currentTenantId),
            eq(knowledgeSources.connectionId, props.identity.connectionId),
            eq(knowledgeSources.sourceType, props.identity.sourceType),
            eq(knowledgeSources.externalId, props.identity.externalId),
          ),
        )
        .limit(1)
        .for("update")
      return row ?? null
    })(),
    mapDatabaseError,
  )

/** Creates a source; null when a concurrent call created the same identity first. */
export const insertSource = (props: {
  tx: Transaction
  values: SourceIdentity & {
    title: string
    sourceUrl: string | null
    knowledgeType: string
    ftsConfig: string
    visibility: string
    owner: string | null
  }
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .insert(knowledgeSources)
        .values(props.values)
        .onConflictDoNothing({
          target: [
            knowledgeSources.tenantId,
            knowledgeSources.connectionId,
            knowledgeSources.sourceType,
            knowledgeSources.externalId,
          ],
        })
        .returning()
      return row ?? null
    })(),
    mapDatabaseError,
  )

export const getSource = (props: { tx: Transaction; id: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(knowledgeSources)
        .where(eq(knowledgeSources.id, props.id))
        .limit(1)
      return row ?? null
    })(),
    mapDatabaseError,
  )

export const getRevision = (props: { tx: Transaction; id: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(sourceRevisions)
        .where(eq(sourceRevisions.id, props.id))
        .limit(1)
      return row ?? null
    })(),
    mapDatabaseError,
  )

/**
 * The newest revision of `sourceId` with `contentHash` whose number is at least
 * `fromRevisionNo` — i.e. the current revision or one accepted after it.
 */
export const findRecentRevisionByHash = (props: {
  tx: Transaction
  sourceId: string
  contentHash: string
  fromRevisionNo: number
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(sourceRevisions)
        .where(
          and(
            eq(sourceRevisions.sourceId, props.sourceId),
            eq(sourceRevisions.contentHash, props.contentHash),
            gte(sourceRevisions.revisionNo, props.fromRevisionNo),
          ),
        )
        .orderBy(desc(sourceRevisions.revisionNo))
        .limit(1)
      return row ?? null
    })(),
    mapDatabaseError,
  )

/** The highest revision number of a source (0 when it has none). */
export const maxRevisionNo = (props: { tx: Transaction; sourceId: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select({ n: sql<number>`coalesce(max(${sourceRevisions.revisionNo}), 0)::int` })
        .from(sourceRevisions)
        .where(eq(sourceRevisions.sourceId, props.sourceId))
      return row?.n ?? 0
    })(),
    mapDatabaseError,
  )

export const insertRevision = (props: {
  tx: Transaction
  values: typeof sourceRevisions.$inferInsert
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx.insert(sourceRevisions).values(props.values).returning()
      if (row === undefined) {
        throw new Error("insert revision: no row")
      }
      return row
    })(),
    mapDatabaseError,
  )

/** Applies a delivery's source metadata and remembers the highest provider version. */
export const touchSource = (props: {
  tx: Transaction
  id: string
  title?: string
  sourceUrl?: string
  knowledgeType?: string
  externalVersion?: number
}) =>
  ResultAsync.fromPromise(
    (async () => {
      await props.tx
        .update(knowledgeSources)
        .set({
          ...(props.title !== undefined ? { title: props.title } : {}),
          ...(props.sourceUrl !== undefined ? { sourceUrl: props.sourceUrl } : {}),
          ...(props.knowledgeType !== undefined ? { knowledgeType: props.knowledgeType } : {}),
          ...(props.externalVersion !== undefined
            ? {
                latestExternalVersion: sql`greatest(coalesce(${knowledgeSources.latestExternalVersion}, ${props.externalVersion}::bigint), ${props.externalVersion}::bigint)`,
              }
            : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(knowledgeSources.id, props.id))
    })(),
    mapDatabaseError,
  )

/**
 * Points the source at `revisionId` unless its current revision is already
 * newer. Returns false when it is (the revision finished too late to matter).
 */
export const switchCurrentRevision = (props: {
  tx: Transaction
  sourceId: string
  revisionId: string
  revisionNo: number
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const res = await props.tx.execute(sql`
        update knowledge_sources s set
          current_revision_id = ${props.revisionId}::uuid,
          available = true,
          updated_at = now()
        where s.id = ${props.sourceId}::uuid
          and s.tombstoned_at is null
          and (
            s.current_revision_id is null
            or s.current_revision_id = ${props.revisionId}::uuid
            or (select r.revision_no from source_revisions r where r.id = s.current_revision_id) < ${props.revisionNo}::int
          )
        returning s.id
      `)
      return res.rows.length > 0
    })(),
    mapDatabaseError,
  )

/** Increments the tenant's corpus revision (creating it at 1) and returns it. */
export const bumpCorpusRevision = (props: { tx: Transaction }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .insert(knowledgeCorpus)
        .values({ revision: 1 })
        .onConflictDoUpdate({
          target: knowledgeCorpus.tenantId,
          set: { revision: sql`${knowledgeCorpus.revision} + 1`, updatedAt: sql`now()` },
        })
        .returning({ revision: knowledgeCorpus.revision })
      return row?.revision ?? 0
    })(),
    mapDatabaseError,
  )

/** The tenant's corpus revision; 0 before anything changed it. */
export const getCorpusRevision = (props: { tx: Transaction }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select({ revision: knowledgeCorpus.revision })
        .from(knowledgeCorpus)
        // One row per tenant: name the tenant, RLS alone is bypassed by an owner.
        .where(eq(knowledgeCorpus.tenantId, currentTenantId))
        .limit(1)
      return row?.revision ?? 0
    })(),
    mapDatabaseError,
  )

export type SourceRefRow = {
  materialId: string
  sourceId: string
  revisionId: string
  sourceType: string
  isCurrent: boolean
  knowledgeType: string
  occurredAt: Date | null
  sourceUrl: string | null
  provenance: unknown
  warnings: unknown
}

/** Source and revision facts for the given materials (those that belong to a revision). */
export const sourceRefsForMaterials = (props: {
  tx: Transaction
  materialIds: readonly string[]
}) =>
  ResultAsync.fromPromise(
    (async (): Promise<SourceRefRow[]> => {
      if (props.materialIds.length === 0) {
        return []
      }
      const rows = await props.tx
        .select({
          materialId: sourceRevisions.materialId,
          sourceId: knowledgeSources.id,
          revisionId: sourceRevisions.id,
          sourceType: knowledgeSources.sourceType,
          isCurrent: sql<boolean>`coalesce(${knowledgeSources.currentRevisionId} = ${sourceRevisions.id}, false)`,
          knowledgeType: knowledgeSources.knowledgeType,
          occurredAt: sourceRevisions.occurredAt,
          sourceUrl: knowledgeSources.sourceUrl,
          provenance: sourceRevisions.provenance,
          warnings: sourceRevisions.warnings,
        })
        .from(sourceRevisions)
        .innerJoin(knowledgeSources, eq(knowledgeSources.id, sourceRevisions.sourceId))
        .where(inArray(sourceRevisions.materialId, [...props.materialIds]))
      return rows.flatMap((r) =>
        r.materialId === null ? [] : [{ ...r, materialId: r.materialId, isCurrent: r.isCurrent }],
      )
    })(),
    mapDatabaseError,
  )

/** The source with this id, row-locked, or null. */
export const lockSourceById = (props: { tx: Transaction; id: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(knowledgeSources)
        .where(eq(knowledgeSources.id, props.id))
        .limit(1)
        .for("update")
      return row ?? null
    })(),
    mapDatabaseError,
  )

/** The revision a material belongs to, or null for a material without a source. */
export const revisionOfMaterial = (props: { tx: Transaction; materialId: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(sourceRevisions)
        .where(eq(sourceRevisions.materialId, props.materialId))
        .limit(1)
      return row ?? null
    })(),
    mapDatabaseError,
  )

export type SourceEventKind = "retracted" | "resurrected" | "purged" | "unavailable" | "available"

export const recordSourceEvent = (props: {
  tx: Transaction
  sourceId: string
  kind: SourceEventKind
  actor: string | null
  reason?: string | null
}) =>
  ResultAsync.fromPromise(
    (async () => {
      await props.tx.insert(sourceEvents).values({
        sourceId: props.sourceId,
        kind: props.kind,
        actor: props.actor,
        reason: props.reason ?? null,
      })
    })(),
    mapDatabaseError,
  )

/** Sets or clears the tombstone. Returns the tombstone time (null when cleared). */
export const setTombstone = (props: {
  tx: Transaction
  id: string
  tombstoned: boolean
  reason?: string | null
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .update(knowledgeSources)
        .set({
          tombstonedAt: props.tombstoned ? sql`now()` : null,
          tombstoneReason: props.tombstoned ? (props.reason ?? null) : null,
          updatedAt: sql`now()`,
        })
        .where(eq(knowledgeSources.id, props.id))
        .returning({ tombstonedAt: knowledgeSources.tombstonedAt })
      return row?.tombstonedAt ?? null
    })(),
    mapDatabaseError,
  )

export const setAvailability = (props: {
  tx: Transaction
  id: string
  available: boolean
  reason: string | null
}) =>
  ResultAsync.fromPromise(
    (async () => {
      await props.tx
        .update(knowledgeSources)
        .set({
          available: props.available,
          availabilityReason: props.reason,
          availabilityChangedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(knowledgeSources.id, props.id))
    })(),
    mapDatabaseError,
  )

/**
 * Removes what a retracted source left: its revisions accepted at or before
 * `before`, their materials (passages, cards, graph mentions and jobs go with
 * them), cached answers that cited them, and graph entities nothing mentions
 * any more. A revision accepted after `before` (the source was brought back)
 * is kept. Run inside the source's tenant.
 */
export const purgeRetractedSource = (props: { tx: Transaction; sourceId: string; before: Date }) =>
  ResultAsync.fromPromise(
    (async () => {
      const before = props.before.toISOString()
      const res = await props.tx.execute(sql`
        select material_id::text as id from source_revisions
        where source_id = ${props.sourceId}::uuid
          and created_at <= ${before}::timestamptz
          and material_id is not null
      `)
      const materialIds = (res.rows as { id: string }[]).map((r) => r.id)
      if (materialIds.length > 0) {
        const list = sql.join(
          materialIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )
        await props.tx.execute(
          sql`delete from answer_cache where source_material_ids && array[${list}]::uuid[]`,
        )
        await props.tx.execute(sql`delete from materials where id in (${list})`)
      }
      await props.tx.execute(sql`
        delete from source_revisions
        where source_id = ${props.sourceId}::uuid and created_at <= ${before}::timestamptz
      `)
      await props.tx.execute(sql`
        delete from kg_entities e
        where e.tenant_id = ${currentTenantId}
          and not exists (select 1 from kg_mentions m where m.entity_id = e.entity_id)
      `)
      return { materials: materialIds.length }
    })(),
    mapDatabaseError,
  )

/** Drops a still-retracted source's descriptive fields once its content is purged. */
export const scrubRetractedSource = (props: { tx: Transaction; id: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      await props.tx
        .update(knowledgeSources)
        .set({ title: "[retracted]", sourceUrl: null, updatedAt: sql`now()` })
        .where(
          and(eq(knowledgeSources.id, props.id), sql`${knowledgeSources.tombstonedAt} is not null`),
        )
    })(),
    mapDatabaseError,
  )

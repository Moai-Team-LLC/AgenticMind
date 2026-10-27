/**
 * Retraction and availability of sources (contract 1.11.0).
 *
 * Retraction (kl_forget by source): the tombstone is set at once, so the
 * source leaves search, answers, reads and counts in the same transaction
 * (retrievable.ts). A background purge job then removes its revisions and
 * everything derived from them; the worker runs it within seconds, and its
 * retries keep it far inside the 24-hour bound. The tombstoned row stays, with
 * its descriptive fields scrubbed, so a later delivery of the same identity
 * answers `retracted` instead of bringing the source back — only an admin's
 * `allowResurrect` does.
 *
 * Availability: a source whose content left the provider is kept but not
 * answered until marked available again or a new revision becomes current.
 * Every change is recorded in `source_events` with the caller's reason and
 * moves the corpus revision.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { SourceIdentity } from "@agenticmind/shared/database/query/knowledge/sources"
import type { Result } from "neverthrow"

import { insertIngestionJob } from "@agenticmind/shared/database/query/knowledge/ingestion-jobs"
import {
  bumpCorpusRevision,
  lockSourceById,
  lockSourceByIdentity,
  recordSourceEvent,
  setAvailability,
  setTombstone,
} from "@agenticmind/shared/database/query/knowledge/sources"
import { hasScope } from "@agenticmind/shared/lib/knowledge/mcp-scopes"

const unwrap = <T>(res: Result<T, { message: string }>): T => {
  if (res.isErr()) {
    throw new Error(res.error.message)
  }
  return res.value
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export type LifecycleDeps = {
  tx: Transaction
  actorUuid: string | null
  scopes?: readonly string[]
}

export type RetractResult =
  | { found: false }
  | { found: true; sourceId: string; tombstonedAt: string; purgeJobId: string | null }

/**
 * Retracts the source named by `identity`, or by `sourceId`. Idempotent: a
 * retracted source answers its existing tombstone. `found: false` when no
 * such source exists in the tenant.
 */
export const retractSource = async (
  deps: LifecycleDeps,
  target: { identity: SourceIdentity } | { sourceId: string },
  reason: string | null,
): Promise<RetractResult> => {
  const { tx } = deps
  let source = null
  if ("identity" in target) {
    source = unwrap(await lockSourceByIdentity({ tx, identity: target.identity }))
  } else if (UUID.test(target.sourceId)) {
    source = unwrap(await lockSourceById({ tx, id: target.sourceId }))
  }
  if (source === null) {
    return { found: false }
  }
  if (source.tombstonedAt !== null) {
    return {
      found: true,
      sourceId: source.id,
      tombstonedAt: source.tombstonedAt.toISOString(),
      purgeJobId: null,
    }
  }
  const tombstonedAt = unwrap(await setTombstone({ tx, id: source.id, tombstoned: true, reason }))
  if (tombstonedAt === null) {
    throw new Error("retract: tombstone not set")
  }
  unwrap(
    await recordSourceEvent({
      tx,
      sourceId: source.id,
      kind: "retracted",
      actor: deps.actorUuid,
      reason,
    }),
  )
  unwrap(await bumpCorpusRevision({ tx }))
  const job = unwrap(
    await insertIngestionJob({
      tx,
      job: {
        kind: "purge_source",
        materialId: null,
        sourceId: source.id,
        createdBy: deps.actorUuid,
        stage: "index",
        status: "queued",
        payload: { before: tombstonedAt.toISOString() },
      },
    }),
  )
  return {
    found: true,
    sourceId: source.id,
    tombstonedAt: tombstonedAt.toISOString(),
    purgeJobId: job?.id ?? null,
  }
}

/** Clears a tombstone for an admin's `allowResurrect`, recorded with the actor. */
export const resurrectSource = async (deps: LifecycleDeps, sourceId: string): Promise<void> => {
  if (!hasScope(deps.scopes, "knowledge:admin")) {
    throw new Error("allowResurrect needs the knowledge:admin scope")
  }
  unwrap(await setTombstone({ tx: deps.tx, id: sourceId, tombstoned: false }))
  unwrap(
    await recordSourceEvent({
      tx: deps.tx,
      sourceId,
      kind: "resurrected",
      actor: deps.actorUuid,
      reason: "allowResurrect",
    }),
  )
}

/**
 * Marks a source unavailable (kept, not answered) or available again.
 * `not_found` for an unknown or retracted source and for a caller that is
 * neither its owner nor knowledge:admin — the three are indistinguishable.
 */
export const setSourceAvailability = async (
  deps: LifecycleDeps,
  identity: SourceIdentity,
  available: boolean,
  reason: string,
): Promise<{ outcome: "updated" | "unchanged" | "not_found" }> => {
  const { tx } = deps
  const source = unwrap(await lockSourceByIdentity({ tx, identity }))
  const admin = hasScope(deps.scopes, "knowledge:admin")
  const permitted =
    source !== null && (admin || (source.owner !== null && source.owner === deps.actorUuid))
  if (source === null || source.tombstonedAt !== null || !permitted) {
    return { outcome: "not_found" }
  }
  if (source.available === available) {
    return { outcome: "unchanged" }
  }
  unwrap(await setAvailability({ tx, id: source.id, available, reason }))
  unwrap(
    await recordSourceEvent({
      tx,
      sourceId: source.id,
      kind: available ? "available" : "unavailable",
      actor: deps.actorUuid,
      reason,
    }),
  )
  unwrap(await bumpCorpusRevision({ tx }))
  return { outcome: "updated" }
}

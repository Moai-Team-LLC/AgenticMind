/**
 * kl_upsert_source (contract 1.11.0): decide what one delivery of a source
 * means and record it. Under a row lock on the source, in this order:
 *
 *   unchanged — the normalized content equals the current revision, or one
 *               accepted after it that is still being indexed
 *   stale     — `externalVersion` is older than one already received
 *   accepted  — a new revision + its material + a background indexing job
 *
 * Before those: `retracted` when the source was retracted (unless an admin
 * passes `allowResurrect`), then `conflict` when `expectedRevisionId` does not
 * match the current revision. The content hash is computed here,
 * never taken from the caller. Visibility other than `workspace` is refused
 * until per-document access control ships, and is fixed at creation. The
 * principal that creates a source owns it; another writer needs
 * knowledge:admin to touch it.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type {
  klUpsertSourceInput,
  klUpsertSourceOutput,
  transcriptSegment,
} from "@agenticmind/shared/lib/knowledge/source-contract"
import type { Lifecycle } from "@agenticmind/shared/lib/knowledge/source-trust"
import type { Result } from "neverthrow"
import type * as z from "zod"

import {
  findIngestionJobByRevision,
  insertIngestionJob,
  requeueFailedIngestionJob,
} from "@agenticmind/shared/database/query/knowledge/ingestion-jobs"
import {
  createMaterial,
  updateMaterialLifecycle,
} from "@agenticmind/shared/database/query/knowledge/materials"
import {
  findRecentRevisionByHash,
  getRevision,
  insertRevision,
  insertSource,
  lockSourceByIdentity,
  maxRevisionNo,
  touchSource,
} from "@agenticmind/shared/database/query/knowledge/sources"
import { isSupportedLanguage } from "@agenticmind/shared/database/schema/knowledge/_config"
import { hasScope } from "@agenticmind/shared/lib/knowledge/mcp-scopes"
import {
  MAX_REVISION_CHARS,
  SUPPORTED_VISIBILITIES,
} from "@agenticmind/shared/lib/knowledge/source-contract"
import { resurrectSource } from "@agenticmind/shared/lib/knowledge/source-lifecycle"
import { createHash } from "node:crypto"

export type UpsertSourceArgs = z.infer<typeof klUpsertSourceInput>
type Segment = z.infer<typeof transcriptSegment>

/** The contract envelope plus the revision's material (kl_ingest answers it). */
export type UpsertSourceResult = z.infer<typeof klUpsertSourceOutput> & {
  materialId: string | null
}

export type UpsertSourceDeps = {
  tx: Transaction
  actorUuid: string | null
  scopes?: readonly string[]
  cardsEnabled?: boolean
  acceptanceEvaluator?: boolean
  graphragEnabled?: boolean
}

/** A delivery the server refuses, with a message meant for the caller. */
export class SourceInputError extends Error {
  override readonly name = "SourceInputError"
}

const DEFAULT_CONNECTION = "default"
const TITLE_MAX = 300

/** NFC, LF line ends, no trailing spaces, trimmed — what "the same text" means. */
export const normalizeText = (text: string): string =>
  text
    .normalize("NFC")
    .replaceAll(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .trim()

/** A dialogue as indexable text: one "speaker: text" line per utterance. */
export const renderSegments = (segments: readonly Segment[]): string =>
  segments
    .map((s) => {
      const text = normalizeText(s.text)
      return s.speaker !== undefined && s.speaker !== null && s.speaker !== ""
        ? `${s.speaker}: ${text}`
        : text
    })
    .join("\n")

/** Normalized revision content and its hash (sha256 hex). */
export const revisionContent = (
  revision: UpsertSourceArgs["revision"],
): { text: string; segments: Segment[] | null; contentHash: string } => {
  const hasText = revision.text !== undefined
  const hasSegments = revision.segments !== undefined
  if (hasText === hasSegments) {
    throw new SourceInputError("revision needs exactly one of 'text' and 'segments'")
  }
  if (revision.segments !== undefined) {
    const segments = revision.segments.map((s) => {
      return {
        speaker: s.speaker ?? null,
        speakerId: s.speakerId ?? null,
        text: normalizeText(s.text),
        startMs: s.startMs ?? null,
        endMs: s.endMs ?? null,
      }
    })
    const text = renderSegments(segments)
    const chars = segments.reduce((n, s) => n + Array.from(s.text).length, 0)
    if (chars > MAX_REVISION_CHARS) {
      throw new SourceInputError(
        `segments carry ${chars} characters; a revision holds at most ${MAX_REVISION_CHARS}`,
      )
    }
    if (segments.every((s) => s.text === "")) {
      throw new SourceInputError("revision content is empty")
    }
    const canonical = JSON.stringify(
      segments.map((s) => [s.speaker, s.speakerId, s.text, s.startMs, s.endMs]),
    )
    return {
      text,
      segments,
      contentHash: createHash("sha256").update(`segments\u0000${canonical}`).digest("hex"),
    }
  }
  const text = normalizeText(revision.text ?? "")
  if (text === "") {
    throw new SourceInputError("revision content is empty")
  }
  return {
    text,
    segments: null,
    contentHash: createHash("sha256").update(`text\u0000${text}`).digest("hex"),
  }
}

const checkVisibility = (source: UpsertSourceArgs["source"]): void => {
  const visibility = source.visibility ?? "workspace"
  if (!SUPPORTED_VISIBILITIES.includes(visibility)) {
    throw new SourceInputError(
      `visibility '${visibility}' is not supported by this server yet — only 'workspace' sources are stored until per-document access control ships`,
    )
  }
  if ((source.recipients ?? []).length > 0) {
    throw new SourceInputError(
      "recipients need 'restricted' or 'personal' visibility, which this server does not support yet",
    )
  }
}

const unwrap = <T>(res: Result<T, { message: string }>): T => {
  if (res.isErr()) {
    throw new Error(res.error.message)
  }
  return res.value
}

type SourceRow = NonNullable<
  Awaited<ReturnType<typeof lockSourceByIdentity>> extends Result<infer T, unknown> ? T : never
>

/** The source for this delivery, row-locked: found (owner and visibility checked) or created. */
const resolveSource = async (
  deps: UpsertSourceDeps,
  args: UpsertSourceArgs,
): Promise<{ source: SourceRow; created: boolean }> => {
  const { tx } = deps
  const identity = {
    connectionId: args.source.connectionId ?? DEFAULT_CONNECTION,
    sourceType: args.source.sourceType,
    externalId: args.source.externalId,
  }
  const existing = unwrap(await lockSourceByIdentity({ tx, identity }))
  if (existing !== null) {
    const admin = hasScope(deps.scopes, "knowledge:admin")
    if (existing.owner !== null && existing.owner !== deps.actorUuid && !admin) {
      throw new SourceInputError("the source belongs to another principal")
    }
    if (args.source.visibility !== undefined && args.source.visibility !== existing.visibility) {
      throw new SourceInputError(
        `visibility is fixed when a source is created (it is '${existing.visibility}')`,
      )
    }
    return { source: existing, created: false }
  }
  const ftsConfig =
    args.source.language !== undefined && isSupportedLanguage(args.source.language)
      ? args.source.language
      : "simple"
  const inserted = unwrap(
    await insertSource({
      tx,
      values: {
        ...identity,
        title:
          args.source.title ?? `${identity.sourceType}:${identity.externalId}`.slice(0, TITLE_MAX),
        sourceUrl: args.source.sourceUrl ?? null,
        knowledgeType: args.source.knowledgeType ?? "canonical",
        ftsConfig,
        visibility: "workspace",
        owner: deps.actorUuid,
      },
    }),
  )
  if (inserted !== null) {
    return { source: inserted, created: true }
  }
  // A concurrent delivery created it first: decide against its row (now locked).
  const raced = unwrap(await lockSourceByIdentity({ tx, identity }))
  if (raced === null) {
    throw new Error("source vanished while being created")
  }
  return resolveSource(deps, args)
}

/** The same content as the current revision, or one accepted after it — or null. */
const findUnchanged = async (
  tx: Transaction,
  source: SourceRow,
  contentHash: string,
  externalVersion: number | undefined,
): Promise<UpsertSourceResult | null> => {
  const current =
    source.currentRevisionId === null
      ? null
      : unwrap(await getRevision({ tx, id: source.currentRevisionId }))
  const same = unwrap(
    await findRecentRevisionByHash({
      tx,
      sourceId: source.id,
      contentHash,
      fromRevisionNo: current?.revisionNo ?? 1,
    }),
  )
  if (same === null) {
    return null
  }
  let job = unwrap(await findIngestionJobByRevision({ tx, revisionId: same.id }))
  if (job?.status === "failed") {
    // A repeated delivery of a revision that failed to index is a request to retry.
    job = unwrap(await requeueFailedIngestionJob({ tx, id: job.id })) ?? job
  }
  unwrap(await touchSource({ tx, id: source.id, externalVersion }))
  const settled = job === null || ["ready", "superseded", "retracted"].includes(job.status)
  return {
    outcome: "unchanged",
    sourceId: source.id,
    revisionId: same.id,
    jobId: settled ? null : (job?.id ?? null),
    contentHash,
    materialId: same.materialId,
  }
}

/** Stores a new revision with its material and queues its indexing job. */
const acceptRevision = async (
  deps: UpsertSourceDeps,
  args: UpsertSourceArgs,
  source: SourceRow,
  content: ReturnType<typeof revisionContent>,
  stamp: { lifecycle?: Lifecycle; trustTier?: number } | undefined,
): Promise<{ revisionId: string; jobId: string; materialId: string }> => {
  const { tx } = deps
  const ev = args.revision.externalVersion
  const title = args.source.title ?? source.title
  const material = unwrap(
    await createMaterial({
      tx,
      input: {
        title,
        source: "manual",
        createdBy: deps.actorUuid,
        ftsConfig: source.ftsConfig,
        sourceUrl: args.source.sourceUrl ?? source.sourceUrl,
      },
    }),
  )
  if (material === null) {
    throw new Error("create material: no row")
  }
  if (stamp !== undefined && (stamp.lifecycle !== undefined || stamp.trustTier !== undefined)) {
    unwrap(await updateMaterialLifecycle({ tx, id: material.id, ...stamp }))
  }
  const revisionNo = unwrap(await maxRevisionNo({ tx, sourceId: source.id })) + 1
  const occurredAt = args.revision.occurredAt
  const revision = unwrap(
    await insertRevision({
      tx,
      values: {
        sourceId: source.id,
        revisionNo,
        contentHash: content.contentHash,
        externalVersion: ev ?? null,
        occurredAt: occurredAt === undefined ? null : new Date(occurredAt),
        contentText: content.text,
        segments: content.segments,
        provenance: args.revision.provenance ?? null,
        warnings: args.revision.warnings ?? [],
        materialId: material.id,
        createdBy: deps.actorUuid,
      },
    }),
  )
  unwrap(
    await touchSource({
      tx,
      id: source.id,
      title: args.source.title,
      sourceUrl: args.source.sourceUrl,
      knowledgeType: args.source.knowledgeType,
      externalVersion: ev,
    }),
  )
  const job = unwrap(
    await insertIngestionJob({
      tx,
      job: {
        materialId: material.id,
        sourceId: source.id,
        revisionId: revision.id,
        createdBy: deps.actorUuid,
        stage: "index",
        status: "queued",
        payload: {
          title,
          cardsEnabled: deps.cardsEnabled === true,
          acceptanceEvaluator: deps.acceptanceEvaluator === true,
          graphragEnabled: deps.graphragEnabled === true,
        },
      },
    }),
  )
  if (job === null) {
    throw new Error("enqueue: no job row")
  }
  return { revisionId: revision.id, jobId: job.id, materialId: material.id }
}

/** Records one delivery. See the module comment for the order of outcomes. */
export const upsertSource = async (
  deps: UpsertSourceDeps,
  args: UpsertSourceArgs,
  stamp?: { lifecycle?: Lifecycle; trustTier?: number },
): Promise<UpsertSourceResult> => {
  checkVisibility(args.source)
  const content = revisionContent(args.revision)
  const expected = args.expectedRevisionId
  if (typeof expected === "string") {
    // Expecting a revision of a source that does not exist yet: nothing to create.
    const existing = unwrap(
      await lockSourceByIdentity({
        tx: deps.tx,
        identity: {
          connectionId: args.source.connectionId ?? DEFAULT_CONNECTION,
          sourceType: args.source.sourceType,
          externalId: args.source.externalId,
        },
      }),
    )
    if (existing === null) {
      return { outcome: "conflict", sourceId: null, currentRevisionId: null, materialId: null }
    }
  }
  if (args.allowResurrect === true && !hasScope(deps.scopes, "knowledge:admin")) {
    throw new SourceInputError("allowResurrect needs the knowledge:admin scope")
  }
  const { source, created } = await resolveSource(deps, args)
  const ev = args.revision.externalVersion

  // A retracted source stays retracted: a repeated delivery does not bring it back.
  if (source.tombstonedAt !== null) {
    if (args.allowResurrect !== true) {
      return { outcome: "retracted", sourceId: source.id, materialId: null }
    }
    await resurrectSource(deps, source.id)
    source.tombstonedAt = null
  }

  // Optimistic lock: `null` expects no current revision, an id expects that one.
  if (expected !== undefined && source.currentRevisionId !== expected) {
    return {
      outcome: "conflict",
      sourceId: source.id,
      currentRevisionId: source.currentRevisionId,
      materialId: null,
    }
  }

  const unchanged = await findUnchanged(deps.tx, source, content.contentHash, ev)
  if (unchanged !== null) {
    return unchanged
  }
  if (
    ev !== undefined &&
    source.latestExternalVersion !== null &&
    ev < source.latestExternalVersion
  ) {
    const current =
      source.currentRevisionId === null
        ? null
        : unwrap(await getRevision({ tx: deps.tx, id: source.currentRevisionId }))
    return {
      outcome: "stale",
      sourceId: source.id,
      currentRevisionId: source.currentRevisionId,
      materialId: current?.materialId ?? null,
    }
  }
  const accepted = await acceptRevision(deps, args, source, content, stamp)
  return {
    outcome: "accepted",
    sourceId: source.id,
    contentHash: content.contentHash,
    created,
    ...accepted,
  }
}

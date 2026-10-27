/**
 * kl_read_source (contract 1.11.0): the stored content of a source revision —
 * the current one, or the exact revision an earlier citation names while it is
 * still stored — whole or in pages. A dialogue revision is read by segment
 * range, a text revision by character offset; both are capped by `maxChars`.
 * The answer carries the revision's content hash, so a quote can be checked
 * against the revision it came from.
 *
 * The same rule as retrieval decides access: a retracted or unavailable source
 * reads as `{ found: false }`, exactly like an unknown one, so "not there" and
 * "not for you" cannot be told apart.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type {
  klReadSourceInput,
  klReadSourceOutput,
} from "@agenticmind/shared/lib/knowledge/source-contract"
import type { Result } from "neverthrow"
import type * as z from "zod"

import { getRevision, getSource } from "@agenticmind/shared/database/query/knowledge/sources"
import {
  READ_SOURCE_DEFAULT_CHARS,
  READ_SOURCE_MAX_CHARS,
} from "@agenticmind/shared/lib/knowledge/source-contract"

type ReadArgs = z.infer<typeof klReadSourceInput>
type ReadResult = z.infer<typeof klReadSourceOutput>
type Found = Extract<ReadResult, { found: true }>
type StoredSegment = {
  speaker?: string | null
  speakerId?: string | null
  text: string
  startMs?: number | null
  endMs?: number | null
}

const NOT_FOUND: ReadResult = { found: false }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** A read the server refuses, with a message meant for the caller. */
export class ReadSourceError extends Error {
  override readonly name = "ReadSourceError"
}

const runes = (s: string): string[] => Array.from(s)

type Base = Omit<Found, "text" | "segments" | "range" | "offset" | "nextOffset" | "truncated">
type SourceRow = NonNullable<
  Awaited<ReturnType<typeof getSource>> extends Result<infer T, unknown> ? T : never
>
type RevisionRow = NonNullable<
  Awaited<ReturnType<typeof getRevision>> extends Result<infer T, unknown> ? T : never
>

/** The source and revision the caller may read, or null (not found and not permitted alike). */
const loadReadable = async (
  tx: Transaction,
  args: ReadArgs,
): Promise<{ source: SourceRow; revision: RevisionRow } | null> => {
  if (!UUID.test(args.sourceId) || (args.revisionId !== undefined && !UUID.test(args.revisionId))) {
    return null
  }
  const sourceRes = await getSource({ tx, id: args.sourceId })
  if (sourceRes.isErr()) {
    throw new Error(sourceRes.error.message)
  }
  const source = sourceRes.value
  if (source === null || source.tombstonedAt !== null || !source.available) {
    return null
  }
  const revisionId = args.revisionId ?? source.currentRevisionId
  if (revisionId === null) {
    return null
  }
  const revisionRes = await getRevision({ tx, id: revisionId })
  if (revisionRes.isErr()) {
    throw new Error(revisionRes.error.message)
  }
  const revision = revisionRes.value
  if (revision === null || revision.sourceId !== source.id) {
    return null
  }
  return { source, revision }
}

const baseOf = (source: SourceRow, revision: RevisionRow, segmentCount: number | null): Base => {
  return {
    found: true,
    sourceId: source.id,
    revisionId: revision.id,
    isCurrent: source.currentRevisionId === revision.id,
    sourceType: source.sourceType,
    externalId: source.externalId,
    connectionId: source.connectionId,
    title: source.title,
    sourceUrl: source.sourceUrl,
    knowledgeType: source.knowledgeType as Found["knowledgeType"],
    visibility: source.visibility as Found["visibility"],
    occurredAt: revision.occurredAt === null ? null : revision.occurredAt.toISOString(),
    capturedAt: revision.capturedAt.toISOString(),
    contentHash: revision.contentHash,
    provenance: (revision.provenance ?? null) as Found["provenance"],
    warnings: Array.isArray(revision.warnings) ? (revision.warnings as string[]) : [],
    totalChars: runes(revision.contentText).length,
    totalSegments: segmentCount,
  }
}

/** A text revision, paged by character offset. */
const readText = (base: Base, content: string, args: ReadArgs, maxChars: number): Found => {
  if (args.range !== undefined) {
    throw new ReadSourceError("range applies to dialogue revisions; read a text revision by offset")
  }
  const text = runes(content)
  const offset = args.offset ?? 0
  const slice = text.slice(offset, offset + maxChars)
  const end = offset + slice.length
  const nextOffset = end < text.length ? end : null
  return {
    ...base,
    text: slice.join(""),
    segments: null,
    range: null,
    offset,
    nextOffset,
    truncated: nextOffset !== null,
  }
}

/** A dialogue revision, paged by segment; at least one segment is always returned. */
const readDialogue = (
  base: Base,
  segments: StoredSegment[],
  args: ReadArgs,
  maxChars: number,
): Found => {
  if (args.offset !== undefined) {
    throw new ReadSourceError("offset applies to text revisions; read a dialogue by range")
  }
  if (args.range !== undefined && args.range.fromSegment > args.range.toSegment) {
    throw new ReadSourceError("range.fromSegment must not be after range.toSegment")
  }
  const from = Math.min(args.range?.fromSegment ?? 0, segments.length)
  const to = Math.min(args.range?.toSegment ?? segments.length - 1, segments.length - 1)
  const out: NonNullable<Found["segments"]> = []
  let used = 0
  let last = from - 1
  for (let i = from; i <= to; i += 1) {
    const seg = segments[i]
    if (seg === undefined) {
      break
    }
    const size = runes(seg.text).length
    if (out.length > 0 && used + size > maxChars) {
      break
    }
    out.push({
      index: i,
      speaker: seg.speaker ?? null,
      speakerId: seg.speakerId ?? null,
      text: seg.text,
      startMs: seg.startMs ?? null,
      endMs: seg.endMs ?? null,
    })
    used += size
    last = i
  }
  const nextOffset = last < to ? last + 1 : null
  return {
    ...base,
    text: null,
    segments: out,
    range: { fromSegment: from, toSegment: last },
    offset: null,
    nextOffset,
    truncated: nextOffset !== null,
  }
}

export const readSource = async (tx: Transaction, args: ReadArgs): Promise<ReadResult> => {
  const readable = await loadReadable(tx, args)
  if (readable === null) {
    return NOT_FOUND
  }
  const { source, revision } = readable
  const maxChars = Math.min(args.maxChars ?? READ_SOURCE_DEFAULT_CHARS, READ_SOURCE_MAX_CHARS)
  const segments = Array.isArray(revision.segments) ? (revision.segments as StoredSegment[]) : null
  const base = baseOf(source, revision, segments === null ? null : segments.length)
  return segments === null
    ? readText(base, revision.contentText, args, maxChars)
    : readDialogue(base, segments, args, maxChars)
}

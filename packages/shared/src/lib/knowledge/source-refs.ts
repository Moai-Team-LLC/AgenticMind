/**
 * The source fields a search hit or a citation carries (contract 1.11.0,
 * `sourceRef` in source-contract.ts): which source and revision a passage came
 * from, whether that revision is current, its knowledge type, date, URL,
 * provenance and known limits. A material ingested without a source gets the
 * neutral values: no source, current, canonical.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { sourceRef } from "@agenticmind/shared/lib/knowledge/source-contract"
import type * as z from "zod"

import { segmentsForChunks } from "@agenticmind/shared/database/query/knowledge/chunks"
import { sourceRefsForMaterials } from "@agenticmind/shared/database/query/knowledge/sources"

export type SourceRef = z.infer<typeof sourceRef>

export const NO_SOURCE_REF: SourceRef = {
  sourceId: null,
  revisionId: null,
  sourceType: null,
  isCurrent: true,
  knowledgeType: "canonical",
  occurredAt: null,
  sourceUrl: null,
  segmentRange: null,
  speaker: null,
  startMs: null,
  endMs: null,
  provenance: null,
  warnings: [],
}

/** Source fields per material id; materials without a source map to NO_SOURCE_REF. */
export const sourceRefsFor = async (
  tx: Transaction,
  materialIds: readonly string[],
): Promise<(materialId: string) => SourceRef> => {
  const rows = await sourceRefsForMaterials({ tx, materialIds: [...new Set(materialIds)] })
  if (rows.isErr()) {
    throw new Error(`source refs: ${rows.error.message}`)
  }
  const byMaterial = new Map<string, SourceRef>()
  for (const r of rows.value) {
    byMaterial.set(r.materialId, {
      ...NO_SOURCE_REF,
      sourceId: r.sourceId,
      revisionId: r.revisionId,
      sourceType: r.sourceType,
      isCurrent: r.isCurrent,
      knowledgeType: r.knowledgeType as SourceRef["knowledgeType"],
      occurredAt: r.occurredAt === null ? null : r.occurredAt.toISOString(),
      sourceUrl: r.sourceUrl,
      provenance: (r.provenance ?? null) as SourceRef["provenance"],
      warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : [],
    })
  }
  return (materialId) => byMaterial.get(materialId) ?? NO_SOURCE_REF
}

/**
 * The origin note the synthesis prompt shows next to a source's title, e.g.
 * `{repo example/repo, path README.md, commit abc1234, environment production;
 * occurred 2026-10-01; limits: partial document}`. Empty for a material
 * without a source, and for a source that states nothing.
 */
export const formatOriginNote = (ref: SourceRef): string => {
  const parts: string[] = []
  // What the content stands for, unless it is the canonical default.
  if (ref.knowledgeType !== "canonical") {
    parts.push(
      ref.knowledgeType === "evidence"
        ? "evidence: what was said, not established fact"
        : "inference: produced by a model",
    )
  }
  const p = ref.provenance
  if (p !== null) {
    const where = [
      p.repo !== undefined ? `repo ${p.repo}` : "",
      p.path !== undefined ? `path ${p.path}` : "",
      p.commitSha !== undefined ? `commit ${p.commitSha}` : "",
      p.ref !== undefined ? `ref ${p.ref}` : "",
      p.environment !== undefined ? `environment ${p.environment}` : "",
    ].filter((x) => x !== "")
    if (where.length > 0) {
      parts.push(where.join(", "))
    }
  }
  if (ref.occurredAt !== null) {
    parts.push(`occurred ${ref.occurredAt.slice(0, 10)}`)
  }
  if (ref.warnings.length > 0) {
    parts.push(`limits: ${ref.warnings.join("; ")}`)
  }
  return parts.length === 0 ? "" : `{${parts.join("; ")}}`
}

/** Sets each source's origin note from its source revision (in place). */
export const annotateOrigins = async (
  tx: Transaction,
  sources: { materialId: string; originNote?: string }[],
): Promise<void> => {
  if (sources.length === 0) {
    return
  }
  const refOf = await sourceRefsFor(
    tx,
    sources.map((s) => s.materialId),
  )
  for (const s of sources) {
    const note = formatOriginNote(refOf(s.materialId))
    if (note !== "") {
      s.originNote = note
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * The utterance fields of passages that cover part of a dialogue: segment
 * range, speaker (when the passage has one), time span. Other passages — and
 * card citations, whose id is not a passage — contribute nothing, so the
 * source-level nulls stand.
 */
export const chunkSegmentsFor = async (
  tx: Transaction,
  chunkIds: readonly string[],
): Promise<(chunkId: string) => Partial<SourceRef>> => {
  const ids = [...new Set(chunkIds)].filter((id) => UUID.test(id))
  const res = await segmentsForChunks({ tx, chunkIds: ids })
  if (res.isErr()) {
    throw new Error(`chunk segments: ${res.error.message}`)
  }
  const byChunk = res.value
  return (chunkId) => byChunk.get(chunkId) ?? {}
}

/**
 * The knowledge type a citation carries: its source's, except that a card
 * drawn from evidence without a verbatim span is the model's restatement of
 * what was said — an inference, not the evidence itself.
 */
export const citationKnowledgeType = (
  origin: string | undefined,
  sourceType: SourceRef["knowledgeType"],
  spanStart: number | null | undefined,
): SourceRef["knowledgeType"] =>
  origin === "card" && sourceType === "evidence" && (spanStart ?? null) === null
    ? "inference"
    : sourceType

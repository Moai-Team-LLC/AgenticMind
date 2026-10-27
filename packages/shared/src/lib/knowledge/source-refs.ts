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

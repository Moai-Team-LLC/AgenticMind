/**
 * High-level ingestion orchestrator — the single entry to populate the
 * knowledge base. Wires the engine end-to-end: upload (blob + material row) →
 * index (sanitize → chunk → embed → cards) → optional graph extraction
 * (entities/relations → GraphStore). Used by the `kl_ingest` MCP tool and the
 * `scripts/ingest.ts` CLI so the base can actually be filled.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { KnowledgeBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import type { GraphStore } from "@agenticmind/shared/lib/knowledge/graph-store"

import { extractGraph } from "@agenticmind/shared/lib/knowledge/graphrag-extractor"
import { indexMaterial } from "@agenticmind/shared/lib/knowledge/indexer"
import { uploadManual } from "@agenticmind/shared/lib/knowledge/ingestion"
import { ResultAsync } from "neverthrow"

export type IngestError = { readonly type: "ingest_error"; readonly message: string }
const ingestError = (message: string): IngestError => ({ type: "ingest_error", message })

export type IngestResult = {
  materialId: string
  title: string
  chunkCount: number
  entities: number
  relations: number
}

const safeFilename = (title: string): string => {
  const base = title
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .slice(0, 80)
  return (base === "" ? "material" : base) + ".txt"
}

/**
 * Ingests a piece of text as a material. Idempotency is the caller's concern
 * (each call creates a new material). Graph extraction only runs when
 * `graphragEnabled` and a `graph` store are provided.
 */
export const ingestText = (props: {
  tx: Transaction
  blobStore: KnowledgeBlobStore
  graph?: GraphStore
  title: string
  text: string
  contentType?: string
  cardsEnabled?: boolean
  graphragEnabled?: boolean
}): ResultAsync<IngestResult, IngestError> => {
  const title = props.title.trim()
  const text = props.text
  const bytes = new TextEncoder().encode(text)

  return ResultAsync.fromPromise(
    (async (): Promise<IngestResult> => {
      const mat = await uploadManual({
        tx: props.tx,
        blobStore: props.blobStore,
        upload: {
          filename: safeFilename(title),
          title,
          contentType: props.contentType ?? "text/plain",
          sizeBytes: bytes.length,
          body: bytes,
        },
      })
      if (mat.isErr()) throw ingestError(`upload: ${mat.error.message}`)
      const material = mat.value

      const indexed = await indexMaterial({
        tx: props.tx,
        material: { id: material.id, title: material.title },
        body: text,
        cardsEnabled: props.cardsEnabled,
      })
      if (indexed.isErr()) throw ingestError(`index: ${indexed.error.message}`)

      let entities = 0
      let relations = 0
      if (props.graphragEnabled === true && props.graph !== undefined) {
        const g = await extractGraph({
          materialId: material.id,
          materialTitle: material.title,
          body: text,
        })
        if (g.isOk()) {
          const up = await props.graph.upsertExtraction(g.value)
          if (up.isOk()) {
            entities = g.value.entities.length
            relations = g.value.relations.length
          }
        }
      }

      return {
        materialId: material.id,
        title: material.title,
        chunkCount: indexed.value.chunkCount,
        entities,
        relations,
      }
    })(),
    (e) =>
      e !== null &&
      typeof e === "object" &&
      "type" in e &&
      (e as IngestError).type === "ingest_error"
        ? (e as IngestError)
        : ingestError(e instanceof Error ? e.message : String(e)),
  )
}

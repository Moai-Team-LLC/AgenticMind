/**
 * Connector import orchestration — ported from the from-url/from-notion/
 * from-google-drive/from-telegram-chat handlers in
 * services/knowledge/internal/httpserver/materials.go. Each pulls content from
 * a source, persists it (blob + material row), stamps the source, extracts
 * text, and indexes (chunks + embeddings + best-effort cards). Env/DB/network
 * coupled; deriveTitle/deriveFilename are pure + unit-tested.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { MaterialSelect } from "@agenticmind/shared/database/schema"
import type { KnowledgeBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import type { MaterialSource } from "@agenticmind/shared/lib/knowledge/material"

import {
  setMaterialSource,
  updateMaterialStatus,
} from "@agenticmind/shared/database/query/knowledge/materials"
import { extract } from "@agenticmind/shared/lib/knowledge/extract"
import { fetchUrl } from "@agenticmind/shared/lib/knowledge/fetch"
import { deriveFilename, deriveTitle } from "@agenticmind/shared/lib/knowledge/import-url"
import { indexMaterial } from "@agenticmind/shared/lib/knowledge/indexer"
import { uploadManual } from "@agenticmind/shared/lib/knowledge/ingestion"
import { errAsync, ResultAsync } from "neverthrow"

export type ImportError = { readonly type: "import_error"; readonly message: string }
const importError = (message: string): ImportError => {
  return { type: "import_error", message }
}

export { deriveFilename, deriveTitle } from "@agenticmind/shared/lib/knowledge/import-url"

export type IngestAndIndexInput = {
  tx: Transaction
  blobStore: KnowledgeBlobStore
  source: MaterialSource
  sourceUrl: string
  filename: string
  title: string
  contentType: string
  body: Uint8Array
  uploaderId?: string | null
  cardsEnabled?: boolean
}

/** Shared tail: upload → setSource → extract → index. Returns the material. */
const ingestAndIndex = (input: IngestAndIndexInput): ResultAsync<MaterialSelect, ImportError> =>
  uploadManual({
    tx: input.tx,
    blobStore: input.blobStore,
    upload: {
      filename: input.filename,
      title: input.title,
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      body: input.body,
      uploaderId: input.uploaderId ?? null,
    },
  })
    .mapErr((e) => importError(e.message))
    .andThen((material) =>
      ResultAsync.fromPromise(
        (async (): Promise<MaterialSelect> => {
          await setMaterialSource({
            tx: input.tx,
            id: material.id,
            source: input.source,
            sourceUrl: input.sourceUrl || null,
          })
          const extracted = await extract(input.contentType, input.body)
          if (extracted.isErr()) {
            await updateMaterialStatus({
              tx: input.tx,
              id: material.id,
              status: "failed",
              errorMessage: extracted.error.message,
            })
            return material
          }
          await indexMaterial({
            tx: input.tx,
            material: { id: material.id, title: input.title },
            body: extracted.value.text,
            extras:
              extracted.value.tables.length > 0 ? { tables: extracted.value.tables } : undefined,
            cardsEnabled: input.cardsEnabled,
          })
          return material
        })(),
        (e) => importError(e instanceof Error ? e.message : String(e)),
      ),
    )

/** POST /materials/from-url equivalent: SSRF-safe fetch → ingest → index. */
export const importFromUrl = (props: {
  tx: Transaction
  blobStore: KnowledgeBlobStore
  url: string
  title?: string
  uploaderId?: string | null
  cardsEnabled?: boolean
}): ResultAsync<MaterialSelect, ImportError> =>
  fetchUrl(props.url)
    .mapErr((e) => importError(`fetch: ${e.message}`))
    .andThen((res) => {
      if (res.body.byteLength === 0) {
        return errAsync(importError("remote returned no body"))
      }
      return ingestAndIndex({
        tx: props.tx,
        blobStore: props.blobStore,
        source: "http_url",
        sourceUrl: res.url,
        filename: deriveFilename(res.url, res.contentType),
        title: (props.title ?? "").trim() || deriveTitle(res.url),
        contentType: res.contentType,
        body: res.body,
        uploaderId: props.uploaderId,
        cardsEnabled: props.cardsEnabled,
      })
    })

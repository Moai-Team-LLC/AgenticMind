/**
 * Ingestion orchestration. The manual-upload path: persist bytes to the
 * blobstore, then insert a
 * material row (status=ingesting). Plus end-to-end delete (row first so the
 * FK cascade drops chunks/cards, then best-effort blob cleanup) and blob fetch
 * for re-indexing.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { MaterialSelect } from "@agenticmind/shared/database/schema"
import type { KnowledgeBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import type { ResultAsync } from "neverthrow"

import {
  createMaterial,
  deleteMaterial as deleteMaterialRow,
  getMaterial,
} from "@agenticmind/shared/database/query/knowledge/materials"
import { errAsync, okAsync } from "neverthrow"
import { randomUUID } from "node:crypto"

/** V1 size cap for a single manual upload (aligned with the multipart limit). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export type IngestionError = { readonly type: "ingestion_error"; readonly message: string }

const ingestionError = (message: string): IngestionError => {
  return { type: "ingestion_error", message }
}

export type ManualUpload = {
  filename: string
  /** Optional admin override; defaults to filename. */
  title?: string
  contentType: string
  sizeBytes: number
  body: Uint8Array
  /** Cuid from the JWT subject claim. */
  uploaderId?: string | null
}

/** Returns the first reason the upload is unacceptable, or null when valid. */
export const validateUpload = (u: ManualUpload): string | null => {
  if (u.filename === "") {
    return "filename is required"
  }
  if (u.sizeBytes <= 0) {
    return "size must be positive"
  }
  if (u.sizeBytes > MAX_UPLOAD_BYTES) {
    return `file too large: ${u.sizeBytes} bytes (max ${MAX_UPLOAD_BYTES})`
  }
  return null
}

/**
 * Stable, collision-resistant blob key: `manual/<material-uuid>/<filename>`.
 * The id prefix means duplicate filenames don't collide; the basename keeps
 * s3-console listings readable.
 */
export const buildObjectKey = (id: string, filename: string): string => {
  const segments = filename.replaceAll("\\", "/").split("/")
  let base = segments.at(-1) ?? ""
  if (base === "" || base === ".") {
    base = "blob"
  }
  return `manual/${id}/${base}`
}

/** Persists bytes + inserts a material row (status=ingesting). */
export const uploadManual = (props: {
  tx: Transaction
  blobStore: KnowledgeBlobStore
  upload: ManualUpload
}): ResultAsync<MaterialSelect, IngestionError> => {
  const invalid = validateUpload(props.upload)
  if (invalid !== null) {
    return errAsync(ingestionError(invalid))
  }

  const id = randomUUID()
  const objectKey = buildObjectKey(id, props.upload.filename)
  const title = (props.upload.title ?? "").trim() || props.upload.filename

  return props.blobStore
    .put({ objectKey, contentType: props.upload.contentType, body: props.upload.body })
    .mapErr((e) => ingestionError(`blob write: ${e.message}`))
    .andThen((storageUri) =>
      createMaterial({
        tx: props.tx,
        input: {
          id,
          title,
          source: "manual",
          mimeType: props.upload.contentType || null,
          sizeBytes: props.upload.sizeBytes,
          storageUri,
          createdBy: props.upload.uploaderId ?? null,
        },
      })
        .mapErr((e) => ingestionError(`persist material: ${e.message}`))
        .andThen((mat) =>
          mat === null ? errAsync(ingestionError("persist material: no row")) : okAsync(mat),
        ),
    )
}

/** Streams the bytes of a previously-uploaded material (for re-indexing). */
export const fetchMaterialBlob = (props: {
  blobStore: KnowledgeBlobStore
  storageUri: string
}): ResultAsync<Uint8Array, IngestionError> => {
  if (props.storageUri === "") {
    return errAsync(ingestionError("empty storage URI"))
  }
  return props.blobStore
    .get({ storageUri: props.storageUri })
    .mapErr((e) => ingestionError(e.message))
}

export type RemoveResult = { removed: boolean; blobCleanupFailed: boolean }

/**
 * Removes a material end-to-end: the DB row first (cascades to chunks/cards),
 * then best-effort blob cleanup. A blob failure is surfaced as
 * blobCleanupFailed (non-fatal — the row is gone, which is the source of
 * truth). Returns removed=false when the material doesn't exist.
 */
export const removeMaterial = (props: {
  tx: Transaction
  blobStore: KnowledgeBlobStore
  id: string
}): ResultAsync<RemoveResult, IngestionError> =>
  getMaterial({ tx: props.tx, id: props.id })
    .mapErr((e) => ingestionError(e.message))
    .andThen((mat) => {
      if (mat === null) {
        return okAsync<RemoveResult, IngestionError>({ removed: false, blobCleanupFailed: false })
      }
      return deleteMaterialRow({ tx: props.tx, id: props.id })
        .mapErr((e) => ingestionError(`delete row: ${e.message}`))
        .andThen(() => {
          const uri = mat.storageUri
          if (uri === null || uri === "") {
            return okAsync<RemoveResult, IngestionError>({
              removed: true,
              blobCleanupFailed: false,
            })
          }
          return props.blobStore
            .delete({ storageUri: uri })
            .map(() => {
              return { removed: true, blobCleanupFailed: false }
            })
            .orElse(() => {
              console.warn(`ingestion: row ${props.id} deleted but blob cleanup failed`)
              return okAsync<RemoveResult, IngestionError>({
                removed: true,
                blobCleanupFailed: true,
              })
            })
        })
    })

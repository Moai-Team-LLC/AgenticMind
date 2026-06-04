/**
 * Object storage for raw ingestion artifacts. The blob is the only source of
 * truth for the unmodified file (chunks/embeddings live in pgvector); reindex
 * flows read it back. Provider-neutral S3: AWS S3 by default, or any
 * S3-compatible store (Cloudflare R2 / MinIO / Backblaze B2 / DigitalOcean
 * Spaces) via a custom endpoint. Plus a Nop store for dev/tests. storageUri uses
 * the s3://bucket/key form so a row records exactly where its bytes live.
 */

import type { S3ClientConfig } from "@aws-sdk/client-s3"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { errAsync, okAsync, ResultAsync } from "neverthrow"

export type BlobError = {
  readonly type: "blob_error"
  readonly message: string
  readonly originalError?: unknown
}

const blobError = (message: string, originalError?: unknown): BlobError => {
  return {
    type: "blob_error",
    message,
    originalError,
  }
}

export type KnowledgeBlobStore = {
  put(props: {
    objectKey: string
    contentType: string
    body: Uint8Array
  }): ResultAsync<string, BlobError>
  get(props: { storageUri: string }): ResultAsync<Uint8Array, BlobError>
  delete(props: { storageUri: string }): ResultAsync<void, BlobError>
}

/** Builds an `s3://bucket/key` storage URI. */
export const buildS3Uri = (bucket: string, key: string): string => `s3://${bucket}/${key}`

/** Parses an `s3://bucket/key` URI, or null when malformed / wrong scheme. */
export const parseS3Uri = (uri: string): { bucket: string; key: string } | null => {
  const prefix = "s3://"
  if (!uri.startsWith(prefix)) {
    return null
  }
  const rest = uri.slice(prefix.length)
  const slash = rest.indexOf("/")
  if (slash <= 0 || slash === rest.length - 1) {
    return null
  }
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) }
}

export type S3BlobStoreConfig = {
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /**
   * Custom S3 endpoint for non-AWS providers (e.g. R2
   * `https://<acct>.r2.cloudflarestorage.com`, MinIO, B2, DO Spaces
   * `https://<region>.digitaloceanspaces.com`). Omit for native AWS S3.
   */
  endpoint?: string
  /** Path-style addressing (endpoint/bucket/key instead of bucket.endpoint/key) — MinIO needs it. */
  forcePathStyle?: boolean
  /** Test/DI override. */
  client?: S3Client
}

/**
 * Builds the S3Client constructor config from a store config. Pure (no client
 * instantiation) so the endpoint / path-style wiring is unit-testable. A custom
 * `endpoint` is only emitted when set, so the default targets native AWS S3.
 */
export const s3ClientConfig = (config: S3BlobStoreConfig): S3ClientConfig => {
  return {
    region: config.region,
    ...(config.endpoint !== undefined && config.endpoint !== ""
      ? { endpoint: config.endpoint }
      : {}),
    forcePathStyle: config.forcePathStyle ?? false,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  }
}

export const createS3BlobStore = (config: S3BlobStoreConfig): KnowledgeBlobStore => {
  const client = config.client ?? new S3Client(s3ClientConfig(config))
  const bucket = config.bucket

  const resolveKey = (storageUri: string): { bucket: string; key: string } | null => {
    const parsed = parseS3Uri(storageUri)
    if (parsed === null) {
      return null
    }
    if (parsed.bucket !== bucket) {
      return null
    }
    return parsed
  }

  return {
    put: ({ objectKey, contentType, body }) => {
      const key = objectKey.replace(/^\/+/, "").trim()
      if (key === "") {
        return errBlob("blobstore: empty object key")
      }
      return ResultAsync.fromPromise(
        (async () => {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: body,
              ContentType: contentType,
            }),
          )
          return buildS3Uri(bucket, key)
        })(),
        (e) => blobError("blobstore: put failed", e),
      )
    },
    get: ({ storageUri }) => {
      const parsed = resolveKey(storageUri)
      if (parsed === null) {
        return errBlob(`blobstore: scheme/bucket mismatch for ${storageUri}`)
      }
      return ResultAsync.fromPromise(
        (async () => {
          const r = await client.send(
            new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
          )
          const bytes = await r.Body?.transformToByteArray()
          if (bytes === undefined) {
            throw new Error("empty body")
          }
          return bytes
        })(),
        (e) => blobError("blobstore: get failed", e),
      )
    },
    delete: ({ storageUri }) => {
      const parsed = resolveKey(storageUri)
      if (parsed === null) {
        return errBlob(`blobstore: scheme/bucket mismatch for ${storageUri}`)
      }
      return ResultAsync.fromPromise(
        (async () => {
          await client.send(new DeleteObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }))
        })(),
        (e) => blobError("blobstore: delete failed", e),
      )
    },
  }
}

const errBlob = <T>(message: string): ResultAsync<T, BlobError> => errAsync(blobError(message))

/** No-op store for dev/tests: returns a nop:// URI, never persists. */
export const nopBlobStore: KnowledgeBlobStore = {
  put: ({ objectKey }) => okAsync(`nop://${objectKey}`),
  get: () => errBlob("blobstore: nop store cannot read bytes back"),
  delete: ({ storageUri }) =>
    storageUri.startsWith("nop://")
      ? okAsync()
      : errBlob("blobstore: nop store only handles nop:// URIs"),
}

/**
 * Resolves the blob store from a bucket + loosely-typed S3 settings (all
 * optional, so the settings module stays import-safe). Storage is opt-in:
 *   - no bucket           → the no-op store (uploads create rows, bytes dropped)
 *   - bucket, no creds    → throws a clear error (don't silently lose bytes)
 *   - bucket + creds      → a live S3 store (region defaults to us-east-1)
 */
export const blobStoreForBucket = (props: {
  bucket: string | undefined
  accessKeyId: string | undefined
  secretAccessKey: string | undefined
  region: string | undefined
  endpoint: string | undefined
  forcePathStyle: boolean
}): KnowledgeBlobStore => {
  if (props.bucket === undefined || props.bucket === "") {
    return nopBlobStore
  }
  if (
    props.accessKeyId === undefined ||
    props.accessKeyId === "" ||
    props.secretAccessKey === undefined ||
    props.secretAccessKey === ""
  ) {
    throw new Error(
      "S3_BUCKET is set but S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are missing — " +
        "provide both, or unset S3_BUCKET to disable blob storage.",
    )
  }
  return createS3BlobStore({
    bucket: props.bucket,
    accessKeyId: props.accessKeyId,
    secretAccessKey: props.secretAccessKey,
    region: props.region ?? "us-east-1",
    endpoint: props.endpoint,
    forcePathStyle: props.forcePathStyle,
  })
}

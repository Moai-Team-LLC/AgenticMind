/**
 * Object storage for raw ingestion artifacts — ported from
 * services/knowledge/internal/blobstore. The blob is the only source of truth
 * for the unmodified file (chunks/embeddings live in pgvector); reindex flows
 * read it back. S3-compatible (DigitalOcean Spaces / MinIO / AWS) via the
 * AWS SDK, plus a Nop store for dev/tests. storageUri uses the s3://bucket/key
 * form so a row records exactly where its bytes live.
 */

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
  /** Defaults to the DigitalOcean Spaces regional endpoint. */
  endpoint?: string
  /** Test/DI override. */
  client?: S3Client
}

export const createS3BlobStore = (config: S3BlobStoreConfig): KnowledgeBlobStore => {
  const client =
    config.client ??
    new S3Client({
      region: config.region,
      endpoint: config.endpoint ?? `https://${config.region}.digitaloceanspaces.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    })
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

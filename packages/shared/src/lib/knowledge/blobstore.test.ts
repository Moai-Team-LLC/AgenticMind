import { describe, expect, it } from "vitest"

import {
  blobStoreForBucket,
  buildS3Uri,
  nopBlobStore,
  parseS3Uri,
  s3ClientConfig,
} from "./blobstore"

describe("s3 uri helpers", () => {
  it("builds and parses round-trip", () => {
    const uri = buildS3Uri("agenticmind-knowledge", "manual/abc/file.pdf")
    expect(uri).toBe("s3://agenticmind-knowledge/manual/abc/file.pdf")
    expect(parseS3Uri(uri)).toEqual({ bucket: "agenticmind-knowledge", key: "manual/abc/file.pdf" })
  })

  it("rejects malformed / non-s3 URIs", () => {
    expect(parseS3Uri("nop://x")).toBeNull()
    expect(parseS3Uri("s3://bucket")).toBeNull()
    expect(parseS3Uri("s3:///key")).toBeNull()
    expect(parseS3Uri("s3://bucket/")).toBeNull()
  })
})

describe("s3ClientConfig", () => {
  const base = { region: "us-east-1", accessKeyId: "k", secretAccessKey: "s", bucket: "b" }

  it("targets native AWS S3 when no endpoint is given (no custom endpoint, virtual-hosted)", () => {
    const cfg = s3ClientConfig(base)
    expect("endpoint" in cfg).toBe(false)
    expect(cfg.forcePathStyle).toBe(false)
    expect(cfg.region).toBe("us-east-1")
    expect(cfg.credentials).toEqual({ accessKeyId: "k", secretAccessKey: "s" })
  })

  it("uses a custom endpoint + path-style for R2 / MinIO", () => {
    const cfg = s3ClientConfig({
      ...base,
      endpoint: "https://acct.r2.cloudflarestorage.com",
      forcePathStyle: true,
    })
    expect(cfg.endpoint).toBe("https://acct.r2.cloudflarestorage.com")
    expect(cfg.forcePathStyle).toBe(true)
  })

  it("treats an empty endpoint as unset (no DigitalOcean lock-in)", () => {
    expect("endpoint" in s3ClientConfig({ ...base, endpoint: "" })).toBe(false)
  })
})

describe("blobStoreForBucket", () => {
  const creds = {
    accessKeyId: "k",
    secretAccessKey: "s",
    region: undefined,
    endpoint: undefined,
    forcePathStyle: false,
  }

  it("returns the no-op store when no bucket is configured (storage off)", () => {
    expect(blobStoreForBucket({ ...creds, bucket: undefined })).toBe(nopBlobStore)
    expect(blobStoreForBucket({ ...creds, bucket: "" })).toBe(nopBlobStore)
  })

  it("throws (does not silently drop bytes) when a bucket is set but creds are missing", () => {
    expect(() =>
      blobStoreForBucket({
        bucket: "b",
        accessKeyId: undefined,
        secretAccessKey: undefined,
        region: undefined,
        endpoint: undefined,
        forcePathStyle: false,
      }),
    ).toThrow(/S3_BUCKET is set but/)
  })

  it("builds a live S3 store when bucket + creds are present", () => {
    const store = blobStoreForBucket({ ...creds, bucket: "agenticmind-knowledge" })
    expect(store).not.toBe(nopBlobStore)
    expect(typeof store.put).toBe("function")
  })
})

describe("nopBlobStore", () => {
  it("returns a nop:// uri and refuses reads", async () => {
    const put = await nopBlobStore.put({
      objectKey: "k/1",
      contentType: "text/plain",
      body: new Uint8Array(),
    })
    expect(put.isOk() && put.value).toBe("nop://k/1")
    expect((await nopBlobStore.get({ storageUri: "nop://k/1" })).isErr()).toBe(true)
    expect((await nopBlobStore.delete({ storageUri: "nop://k/1" })).isOk()).toBe(true)
    expect((await nopBlobStore.delete({ storageUri: "s3://b/k" })).isErr()).toBe(true)
  })
})

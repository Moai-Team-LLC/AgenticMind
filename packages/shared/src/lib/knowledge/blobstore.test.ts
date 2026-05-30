import { describe, expect, it } from "vitest"

import { buildS3Uri, nopBlobStore, parseS3Uri } from "./blobstore"

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

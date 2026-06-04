// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

/**
 * Object-storage (S3-compatible) credentials for retaining raw ingested bytes.
 * Provider-neutral: AWS S3 by default; Cloudflare R2, MinIO, Backblaze B2,
 * DigitalOcean Spaces, … all work — point `S3_ENDPOINT` at the provider (omit
 * for AWS) and set `S3_FORCE_PATH_STYLE=true` for MinIO-style addressing.
 *
 * Every field is OPTIONAL so this module is import-safe even when storage is
 * off — `createEnv` validates eagerly at import, and the MCP server imports this
 * on boot. Storage is enabled by `S3_BUCKET` (knowledge-feature-settings); the
 * presence of the credentials is enforced at the point of use
 * (`blobStoreForBucket`), which fails loudly if a bucket is set without keys.
 * The deprecated `SPACES_*` names are accepted as a fallback.
 */
export const storageSettings = createEnv({
  server: {
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /** S3 region; defaults to `us-east-1` at the point of use. */
    S3_REGION: z.string().optional(),
    /** Custom endpoint for non-AWS providers (R2 / MinIO / B2 / DO Spaces). */
    S3_ENDPOINT: z.url().optional(),
    /** "true" for path-style addressing (endpoint/bucket/key) — MinIO needs it. */
    S3_FORCE_PATH_STYLE: z.string().optional(),
  },
  runtimeEnv: {
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? process.env.SPACES_ACCESS_KEY,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? process.env.SPACES_SECRET_KEY,
    S3_REGION: process.env.S3_REGION ?? process.env.SPACES_REGION,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
  // Empty env (e.g. an unset `${S3_ENDPOINT:-}` passthrough in docker-compose)
  // is treated as absent, so blank values don't trip url validation.
  emptyStringAsUndefined: true,
})

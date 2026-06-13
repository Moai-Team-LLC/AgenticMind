/**
 * Ingestion CLI — populate the knowledge base from a file or raw text.
 * Runs the full engine: upload → extract → chunk → embed → cards → graph.
 * Needs DATABASE_URL + CHAT_API_KEY (+ S3_* to retain raw bytes).
 *
 *   bun run ingest --file ./guide.pdf [--title "product manual"]
 *   bun run ingest --text "The widget API rate limit is 100 req/s." --title "Widget API"
 */

import { createClient } from "@agenticmind/shared/database/client"
import { blobStoreForBucket } from "@agenticmind/shared/lib/knowledge/blobstore"
import { extract } from "@agenticmind/shared/lib/knowledge/extract"
import { ingestText } from "@agenticmind/shared/lib/knowledge/ingest"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { storageSettings } from "@agenticmind/shared/settings/storage-settings"
import { readFileSync } from "node:fs"
import { basename, extname } from "node:path"

const argv = process.argv.slice(2)
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 ? argv[i + 1] : undefined
}

const MIME_BY_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/plain",
  ".json": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".html": "text/html",
  ".htm": "text/html",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

const db = createClient(databaseSettings.DATABASE_URL)
const blobStore = blobStoreForBucket({
  bucket: process.env.S3_BUCKET ?? process.env.SPACES_KNOWLEDGE_BUCKET,
  accessKeyId: storageSettings.S3_ACCESS_KEY_ID,
  secretAccessKey: storageSettings.S3_SECRET_ACCESS_KEY,
  region: storageSettings.S3_REGION,
  endpoint: storageSettings.S3_ENDPOINT,
  forcePathStyle: storageSettings.S3_FORCE_PATH_STYLE === "true",
})
const cardsEnabled = process.env.KNOWLEDGE_CARDS_ENABLED === "true"

const file = arg("file")
const text = arg("text")
let title = arg("title")
let body: string

if (file !== undefined) {
  const bytes = new Uint8Array(readFileSync(file))
  const mime = MIME_BY_EXT[extname(file).toLowerCase()] ?? "text/plain"
  const ex = await extract(mime, bytes)
  if (ex.isErr()) {
    console.error("extract failed:", ex.error.message)
    process.exit(1)
  }
  body = ex.value.text
  title ??= basename(file)
} else if (text !== undefined) {
  body = text
} else {
  console.error('usage: bun run ingest --file <path> [--title <t>] | --text "..." --title <t>')
  process.exit(2)
}

if (title === undefined || title === "") {
  console.error("--title is required")
  process.exit(2)
}

const res = await ingestText({
  tx: db,
  blobStore,
  title,
  text: body,
  cardsEnabled,
})
if (res.isErr()) {
  console.error("ingest failed:", res.error.message)
  process.exit(1)
}
const r = res.value
console.log(
  `Ingested "${r.title}" -> material ${r.materialId}: ${r.chunkCount} chunks`,
)
process.exit(0)

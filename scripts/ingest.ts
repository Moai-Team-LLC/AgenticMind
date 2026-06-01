/**
 * Ingestion CLI — populate the knowledge base from a file or raw text.
 * Runs the full engine: upload → extract → chunk → embed → cards → graph.
 * Needs DATABASE_URL + OPENROUTER_API_KEY (+ SPACES_* to retain raw bytes).
 *
 *   bun run ingest --file ./guide.pdf [--title "product manual"]
 *   bun run ingest --text "The widget API rate limit is 100 req/s." --title "Widget API"
 */

import { createClient } from "@agenticmind/shared/database/client"
import { createS3BlobStore, nopBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import { extract } from "@agenticmind/shared/lib/knowledge/extract"
import { createPostgresGraphStore } from "@agenticmind/shared/lib/knowledge/graphrag-postgres"
import { ingestText } from "@agenticmind/shared/lib/knowledge/ingest"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { spacesSettings } from "@agenticmind/shared/settings/spaces-settings"
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
const bucket = process.env.SPACES_KNOWLEDGE_BUCKET
const blobStore =
  bucket !== undefined && bucket !== ""
    ? createS3BlobStore({
        region: spacesSettings.SPACES_REGION,
        accessKeyId: spacesSettings.SPACES_ACCESS_KEY,
        secretAccessKey: spacesSettings.SPACES_SECRET_KEY,
        bucket,
      })
    : nopBlobStore
const cardsEnabled = process.env.KNOWLEDGE_CARDS_ENABLED === "true"
const graphragEnabled = process.env.KNOWLEDGE_GRAPHRAG_ENABLED === "true"
const graph = graphragEnabled ? createPostgresGraphStore(db) : undefined

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
  graph,
  title,
  text: body,
  cardsEnabled,
  graphragEnabled,
})
if (res.isErr()) {
  console.error("ingest failed:", res.error.message)
  process.exit(1)
}
const r = res.value
console.log(
  `Ingested "${r.title}" -> material ${r.materialId}: ${r.chunkCount} chunks, ${r.entities} entities, ${r.relations} relations`,
)
process.exit(0)

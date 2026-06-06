/**
 * Seed the eval corpus — ingest the vendored Agentic Product Standard
 * (eval/corpus/agentic-product-standard.md) into the knowledge base so the eval
 * suite's factual_retrieval / citation_grounding cases have something to ground
 * against. Splits the markdown into one material per top-level `## ` section and
 * runs the full ingest engine (chunk → embed → cards → graph) on each.
 *
 * Run against a fresh/clean eval database (it creates new materials each run):
 *   dotenvx run -f .env.local -- bun scripts/seed-eval-corpus.ts
 *
 * Suggested package.json "scripts" entry (add manually):
 *   "seed-eval": "dotenvx run -f .env.local -- bun scripts/seed-eval-corpus.ts",
 *
 * Needs DATABASE_URL (+ a chat key only if KNOWLEDGE_CARDS/GRAPHRAG are enabled;
 * embeddings are local by default).
 */

import { createClient } from "@agenticmind/shared/database/client"
import { nopBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import { createPostgresGraphStore } from "@agenticmind/shared/lib/knowledge/graphrag-postgres"
import { ingestText } from "@agenticmind/shared/lib/knowledge/ingest"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { readFileSync } from "node:fs"
import { join } from "node:path"

type Section = { title: string; text: string }

/** Split the standard into one section per level-2 (`## `) heading. */
const splitSections = (markdown: string): Section[] => {
  // Drop a leading HTML comment (the vendoring note) and the H1 title block.
  const body = markdown.replace(/^<!--[\s\S]*?-->\s*/u, "")
  const lines = body.split("\n")
  const sections: Section[] = []
  let title = "The Agentic Product Standard — Overview"
  let buf: string[] = []
  const flush = (): void => {
    const text = buf.join("\n").trim()
    if (text !== "") {
      sections.push({ title, text })
    }
  }
  for (const line of lines) {
    const heading = /^##\s+(.+)$/u.exec(line)
    if (heading !== null) {
      flush()
      title = heading[1].trim()
      buf = [line]
    } else {
      buf.push(line)
    }
  }
  flush()
  return sections
}

const corpusDir = join(import.meta.dir, "..", "eval", "corpus")
// The standard provides factual_retrieval / citation_grounding ground truth; the
// red-team fixture carries an embedded indirect injection for the
// indirect_injection cases (Layer 8 / DoD 13).
const sections = [
  ...splitSections(readFileSync(join(corpusDir, "agentic-product-standard.md"), "utf8")),
  ...splitSections(readFileSync(join(corpusDir, "redteam-indirect-injection.md"), "utf8")),
]

const db = createClient(databaseSettings.DATABASE_URL)
const cardsEnabled = process.env.KNOWLEDGE_CARDS_ENABLED === "true"
const graphragEnabled = process.env.KNOWLEDGE_GRAPHRAG_ENABLED === "true"
const graph = graphragEnabled ? createPostgresGraphStore(db) : undefined

console.log(`[SEED] ingesting ${sections.length} sections from the eval corpus`)

let ok = 0
let failed = 0
for (const section of sections) {
  const res = await ingestText({
    tx: db,
    blobStore: nopBlobStore,
    graph,
    title: section.title,
    text: section.text,
    cardsEnabled,
    graphragEnabled,
  })
  if (res.isErr()) {
    failed += 1
    console.error(`[SEED] "${section.title}" failed: ${res.error.message}`)
  } else {
    ok += 1
    console.log(`[SEED] "${section.title}" -> ${res.value.chunkCount} chunks`)
  }
}

console.log(`[SEED] done: ${ok} ingested, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

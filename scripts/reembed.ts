/**
 * Re-embed maintenance CLI — recompute & rewrite every stored embedding vector.
 *
 * The embedding model/dimension changed (now 1024-dim multilingual bge-m3),
 * which invalidates any previously stored vectors. This walks all three tables
 * that carry an `embedding vector(1024)` column (chunks, knowledge_cards,
 * beliefs), recomputes each row's embedding via the shared embedder, and writes
 * it back — stamping `embedding_model = KNOWLEDGE_EMBEDDING_MODEL` where that
 * column exists (chunks & cards; beliefs has no such column).
 *
 * Idempotent & resumable: rows are processed oldest-first (createdAt, id), in
 * batches of EMBED_BATCH. A single-row failure is logged and skipped — it never
 * aborts the run. Re-running simply recomputes the same rows (writing the same
 * model id), so an interrupted run can be restarted safely.
 *
 * Flags:
 *   --table=chunks|cards|beliefs   limit to one table (default: all three)
 *   --dry-run                      count rows only; no writes
 *
 * Needs DATABASE_URL + OPENROUTER_API_KEY (same env as `ingest`). Run via the
 * dotenvx wrapper:
 *
 *   dotenvx run -f .env.local -- bun scripts/reembed.ts
 *   dotenvx run -f .env.local -- bun scripts/reembed.ts --table=beliefs
 *   dotenvx run -f .env.local -- bun scripts/reembed.ts --dry-run
 *
 * Suggested package.json "scripts" entry (add manually):
 *   "reembed": "dotenvx run -f .env.local -- bun scripts/reembed.ts",
 * then: bun run reembed [--table=chunks|cards|beliefs] [--dry-run]
 */

import type { Transaction } from "@agenticmind/shared/database/client"

import { createClient } from "@agenticmind/shared/database/client"
import { beliefs, chunks, knowledgeCards } from "@agenticmind/shared/database/schema"
import {
  embedKnowledgeBatch,
  KNOWLEDGE_EMBEDDING_MODEL,
} from "@agenticmind/shared/lib/knowledge/llm"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { asc, eq } from "drizzle-orm"

const EMBED_BATCH = 100

const argv = process.argv.slice(2)
const hasFlag = (name: string): boolean => argv.includes(`--${name}`)
const flagValue = (name: string): string | undefined => {
  const prefix = `--${name}=`
  const hit = argv.find((a) => a.startsWith(prefix))
  return hit !== undefined ? hit.slice(prefix.length) : undefined
}

const dryRun = hasFlag("dry-run")

type TableName = "chunks" | "cards" | "beliefs"
const ALL_TABLES: TableName[] = ["chunks", "cards", "beliefs"]

const tableArg = flagValue("table")
if (tableArg !== undefined && !ALL_TABLES.includes(tableArg as TableName)) {
  console.error(`reembed: invalid --table=${tableArg} (expected chunks|cards|beliefs)`)
  process.exit(2)
}
const targets: TableName[] = tableArg !== undefined ? [tableArg as TableName] : ALL_TABLES

/** Per-table counters surfaced in the final summary. */
type Counts = { total: number; updated: number; skipped: number; failed: number }
const newCounts = (): Counts => {return { total: 0, updated: 0, skipped: 0, failed: 0 }}

/** One row to re-embed: its id, the text to embed, and whether it can be skipped. */
type Row = { id: string; text: string }

/**
 * Generic re-embed driver for one table. `load` pages rows oldest-first;
 * `write` rewrites a single row's embedding (+ model where applicable). Failures
 * at the batch level (the embedder itself) mark the whole batch failed and move
 * on; failures at the row level mark just that row failed.
 */
/** Writes a batch of embeddings row-by-row, counting outcomes. Isolated so the
 * driver loop stays shallow. */
const writeEmbeddedBatch = async (
  name: TableName,
  rows: Row[],
  vectors: number[][],
  write: (id: string, embedding: number[]) => Promise<void>,
  counts: Counts,
): Promise<void> => {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const vector = vectors[i]
    if (row === undefined || vector === undefined) {
      counts.failed += 1
      continue
    }
    try {
      await write(row.id, vector)
      counts.updated += 1
    } catch (error) {
      counts.failed += 1
      console.warn(
        `[REEMBED] ${name} row ${row.id} write failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

const reembedTable = async (props: {
  tx: Transaction
  name: TableName
  load: (limit: number, offset: number) => Promise<Row[]>
  write: (id: string, embedding: number[]) => Promise<void>
}): Promise<Counts> => {
  const counts = newCounts()
  let offset = 0

  for (;;) {
    const batch = await props.load(EMBED_BATCH, offset)
    if (batch.length === 0) {
      break
    }

    // Embeddable rows = non-empty text. Empty-text rows are skipped (the
    // embedder rejects empty input and they carry no signal anyway).
    const embeddable = batch.filter((r) => r.text.trim() !== "")
    const skippedThisBatch = batch.length - embeddable.length
    counts.skipped += skippedThisBatch

    if (dryRun) {
      counts.total += batch.length
      offset += batch.length
      console.log(
        `[REEMBED] ${props.name} ${counts.total} (dry-run; ${skippedThisBatch} empty in batch)`,
      )
      continue
    }

    if (embeddable.length > 0) {
      const embedded = await embedKnowledgeBatch(embeddable.map((r) => r.text))
      if (embedded.isErr()) {
        // Whole-batch embed failure: log, count as failed, keep going.
        counts.failed += embeddable.length
        console.warn(
          `[REEMBED] ${props.name} batch embed failed at offset ${offset}: ${embedded.error.message}`,
        )
      } else {
        await writeEmbeddedBatch(props.name, embeddable, embedded.value, props.write, counts)
      }
    }

    counts.total += batch.length
    offset += batch.length
    console.log(
      `[REEMBED] ${props.name} ${counts.total} (updated ${counts.updated}, skipped ${counts.skipped}, failed ${counts.failed})`,
    )
  }

  return counts
}

const reembedChunks =  async (tx: Transaction): Promise<Counts> =>
  reembedTable({
    tx,
    name: "chunks",
    load: (limit, offset) =>
      tx
        .select({ id: chunks.id, text: chunks.body })
        .from(chunks)
        .orderBy(asc(chunks.createdAt), asc(chunks.id))
        .limit(limit)
        .offset(offset),
    write: async (id, embedding) => {
      await tx
        .update(chunks)
        .set({ embedding, embeddingModel: KNOWLEDGE_EMBEDDING_MODEL })
        .where(eq(chunks.id, id))
    },
  })

const reembedCards =  async (tx: Transaction): Promise<Counts> =>
  reembedTable({
    tx,
    name: "cards",
    load: (limit, offset) =>
      tx
        .select({ id: knowledgeCards.id, text: knowledgeCards.body })
        .from(knowledgeCards)
        .orderBy(asc(knowledgeCards.createdAt), asc(knowledgeCards.id))
        .limit(limit)
        .offset(offset),
    write: async (id, embedding) => {
      await tx
        .update(knowledgeCards)
        .set({ embedding, embeddingModel: KNOWLEDGE_EMBEDDING_MODEL })
        .where(eq(knowledgeCards.id, id))
    },
  })

const reembedBeliefs =  async (tx: Transaction): Promise<Counts> =>
  reembedTable({
    tx,
    name: "beliefs",
    // Belief embedding text mirrors mem_write: `${subject} ${predicate} ${object}`.
    load: async (limit, offset) => {
      const rows = await tx
        .select({
          id: beliefs.id,
          subject: beliefs.subject,
          predicate: beliefs.predicate,
          object: beliefs.object,
        })
        .from(beliefs)
        .orderBy(asc(beliefs.createdAt), asc(beliefs.id))
        .limit(limit)
        .offset(offset)
      return rows.map((r) => {return { id: r.id, text: `${r.subject} ${r.predicate} ${r.object}` }})
    },
    // NB: beliefs has no `embedding_model` column — only the vector is rewritten.
    write: async (id, embedding) => {
      await tx.update(beliefs).set({ embedding }).where(eq(beliefs.id, id))
    },
  })

const RUNNERS: Record<TableName, (tx: Transaction) => Promise<Counts>> = {
  chunks: reembedChunks,
  cards: reembedCards,
  beliefs: reembedBeliefs,
}

const db = createClient(databaseSettings.DATABASE_URL)

console.log(
  `[REEMBED] start model=${KNOWLEDGE_EMBEDDING_MODEL} tables=${targets.join(",")}${
    dryRun ? " (dry-run)" : ""
  }`,
)

const summary: Record<string, Counts> = {}
for (const name of targets) {
  const counts = await RUNNERS[name](db)
  summary[name] = counts
}

console.log("[REEMBED] done")
let anyFailed = false
for (const name of targets) {
  const c = summary[name] ?? newCounts()
  if (c.failed > 0) {
    anyFailed = true
  }
  console.log(
    `[REEMBED] ${name}: total ${c.total}, updated ${c.updated}, skipped ${c.skipped}, failed ${c.failed}`,
  )
}

process.exit(anyFailed ? 1 : 0)

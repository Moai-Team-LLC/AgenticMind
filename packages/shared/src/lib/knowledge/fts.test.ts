// oxlint-disable node/no-process-env
// oxlint-disable import/no-unassigned-import
// oxlint-disable typescript/no-explicit-any
import "./_test-env"
import { createClient } from "@agenticmind/shared/database/client"
import {
  buildFtsWhereClause,
  searchChunksBm25,
} from "@agenticmind/shared/database/query/knowledge/chunks"
import { sql } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { okAsync } from "neverthrow"
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest"

import { nopBlobStore } from "./blobstore"
import { ingestText } from "./ingest"

vi.mock("@agenticmind/shared/lib/knowledge/llm", () => {
  return {
    KNOWLEDGE_EMBEDDING_MODEL: "Xenova/bge-m3",
    embedKnowledgeBatch: (texts: string[]) => {
      const dummyVector = Array.from({ length: 1024 }, () => 0)
      return okAsync(texts.map(() => dummyVector))
    },
  }
})

describe("buildFtsWhereClause", () => {
  it("builds an OR-expanded query covering all supported languages", () => {
    // We can simulate columns just by providing objects with a name for the test
    const mockTable = {
      ftsConfig: sql.identifier("fts_config") as any,
      bodyTsv: sql.identifier("body_tsv") as any,
    }

    const clause = buildFtsWhereClause(mockTable, ["test"])

    // The generated SQL should include branches for simple and german, etc.
    const dialect = new PgDialect()
    const query = dialect.sqlToQuery(clause)
    const sqlString = query.sql

    expect(sqlString).toContain("fts_config")
    expect(sqlString).toContain("body_tsv")
    expect(query.params).toContain("simple")
    expect(query.params).toContain("german")
  })
})

describe.skipIf(process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === "")(
  "FTS Integration (Real DB)",
  () => {
    let db: ReturnType<typeof createClient>

    beforeAll(async () => {
      db = createClient(process.env.DATABASE_URL!)
    })

    afterAll(async () => {
      await (db as any).$client.end()
    })

    it("ingests and retrieves german text correctly using stems", async () => {
      // German text: "Der schnelle braune Fuchs läuft über den faulen Hund"
      // We will ingest it and then search for "laufen".
      // With German stemmer, "laufen" and "läuft" should match.

      const ingestResult = await ingestText({
        tx: db,
        blobStore: nopBlobStore,
        title: "German Test",
        text: "Der schnelle braune Fuchs läuft über den faulen Hund",
        language: "german",
      })

      expect(ingestResult.isOk()).toBe(true)

      const searchResult = await searchChunksBm25({
        tx: db,
        query: "laufen",
      })

      expect(searchResult.isOk()).toBe(true)
      if (searchResult.isOk()) {
        const hits = searchResult.value
        expect(hits.length).toBeGreaterThan(0)
        const firstHit = hits[0]!
        expect(firstHit.body).toContain("läuft")
      }
    })
  },
)

import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { buildFtsWhereClause } from "@agenticmind/shared/database/query/knowledge/chunks"
import { sql } from "drizzle-orm"
import { PgColumn } from "drizzle-orm/pg-core"
import { createClient } from "@agenticmind/shared/database/client"
import { ingestText } from "./ingest"
import { searchChunks } from "@agenticmind/shared/database/query/knowledge/chunks"

describe("buildFtsWhereClause", () => {
  it("builds an OR-expanded query covering all supported languages", () => {
    // We can simulate columns just by providing objects with a name for the test
    const mockTable = {
      ftsConfig: sql.identifier("fts_config") as any,
      bodyTsv: sql.identifier("body_tsv") as any,
    }

    const clause = buildFtsWhereClause(mockTable, ["test"])
    
    // The generated SQL should include branches for simple and german, etc.
    const sqlString = clause.toQuery({ escapeString: (str) => `'${str}'`, escapeParam: (num) => `$${num}`, escapeIdentifier: (str) => `"${str}"` }).sql

    expect(sqlString).toContain("(\"fts_config\" = 'simple' AND \"body_tsv\" @@ (plainto_tsquery('simple', $1)))")
    expect(sqlString).toContain("(\"fts_config\" = 'german' AND \"body_tsv\" @@ (plainto_tsquery('german', $2)))")
    expect(sqlString).toContain(" OR ")
  })
})

describe.skipIf(!process.env.DATABASE_URL)("FTS Integration (Real DB)", () => {
  let db: ReturnType<typeof createClient>

  beforeAll(async () => {
    db = createClient(process.env.DATABASE_URL!)
  })

  afterAll(async () => {
    await (db as any).$client.end()
  })

  it("ingests and retrieves german text correctly using stems", async () => {
    // German text: "Der schnelle braune Fuchs springt über den faulen Hund"
    // We will ingest it and then search for "springen" (infinitive) or "springt"
    // With German stemmer, "springen" and "springt" should match.

    const ingestResult = await ingestText({
      tx: db,
      title: "German Test",
      text: "Der schnelle braune Fuchs springt über den faulen Hund",
      language: "german",
    })

    expect(ingestResult.isOk()).toBe(true)

    const searchResult = await searchChunks({
      tx: db,
      query: "springen", // infinitive, testing stemming
    })

    expect(searchResult.isOk()).toBe(true)
    if (searchResult.isOk()) {
      const hits = searchResult.value
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0].body).toContain("springt")
    }
  })
})

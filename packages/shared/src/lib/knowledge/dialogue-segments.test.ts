// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Database } from "@agenticmind/shared/database/client"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import { searchChunksBm25 } from "@agenticmind/shared/database/query/knowledge/chunks"
import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { splitSegments } from "@agenticmind/shared/lib/knowledge/chunker"
import { runIngestionTick } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import { chunkSegmentsFor } from "@agenticmind/shared/lib/knowledge/source-refs"
import { upsertSource } from "@agenticmind/shared/lib/knowledge/source-upsert"
import { sql } from "drizzle-orm"
import { okAsync } from "neverthrow"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Dialogue passages along utterance boundaries (contract 1.11.0): each passage
 * knows the utterances and the time span it covers, and a citation names them.
 */

const seg = (speaker: string, text: string, startMs: number, endMs: number) => {
  return { speaker, text, startMs, endMs }
}

describe("splitSegments", () => {
  it("cuts at utterance boundaries and repeats the last utterance in the next passage", () => {
    const segments = [
      seg("A", "a".repeat(40), 0, 1000),
      seg("B", "b".repeat(40), 1000, 2000),
      seg("A", "c".repeat(40), 2000, 3000),
      seg("B", "d".repeat(40), 3000, 4000),
    ]
    const pieces = splitSegments(segments, { maxRunes: 90 })
    expect(pieces.map((p) => [p.segmentFrom, p.segmentTo])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ])
    expect(pieces[0]).toMatchObject({ startMs: 0, endMs: 2000, speaker: null })
    expect(pieces[0]?.body).toBe(`A: ${"a".repeat(40)}\nB: ${"b".repeat(40)}`)
  })

  it("names the speaker when the passage has only one, and splits an overlong utterance on its own", () => {
    const long = "word ".repeat(60).trim()
    const pieces = splitSegments([seg("A", "short", 0, 500), seg("B", long, 500, 9000)], {
      maxRunes: 100,
      overlap: 10,
    })
    expect(pieces[0]).toMatchObject({ segmentFrom: 0, segmentTo: 0, speaker: "A" })
    const rest = pieces.slice(1)
    expect(rest.length).toBeGreaterThan(1)
    for (const p of rest) {
      expect(p).toMatchObject({
        segmentFrom: 1,
        segmentTo: 1,
        speaker: "B",
        startMs: 500,
        endMs: 9000,
      })
    }
  })
})

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("dialogue citations (real Postgres)", () => {
  const TENANT = randomUUID()
  const WORD = `zd${randomUUID().replaceAll("-", "").slice(0, 10)}`
  const sources: string[] = []
  let db: Database
  const unit = Array.from({ length: EMBEDDING_DIMENSIONS }, (_v, i) => (i === 0 ? 1 : 0))

  beforeAll(() => {
    db = createClient(DB_URL)
  })
  afterAll(async () => {
    for (const id of sources) {
      await db.execute(
        sql`delete from materials where id in (select material_id from source_revisions where source_id = ${id}::uuid)`,
      )
      await db.execute(sql`delete from knowledge_sources where id = ${id}::uuid`)
    }
    await db.execute(sql`delete from knowledge_corpus where tenant_id = ${TENANT}::uuid`)
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  })

  it("a citation names the utterance and the moment it was said", async () => {
    // Forty utterances; the needle is said once, in utterance 27, by the respondent.
    const segments = Array.from({ length: 40 }, (_v, i) =>
      seg(
        i % 2 === 0 ? "Interviewer" : "Respondent",
        i === 27
          ? `The ${WORD} export takes an hour every Monday.`
          : `Filler utterance number ${i} about the weather and the office.`,
        i * 3000,
        i * 3000 + 2500,
      ),
    )
    const out = await withTenant(db, TENANT, async (tx) =>
      upsertSource(
        { tx, actorUuid: randomUUID(), scopes: ["knowledge:write"] },
        {
          source: { sourceType: "meeting", externalId: `m-${randomUUID()}` },
          revision: { segments },
        },
      ),
    )
    if (out.outcome !== "accepted") {
      throw new Error("expected accepted")
    }
    sources.push(out.sourceId)
    await runIngestionTick(
      { db, workerId: `test-${randomUUID()}`, embed: (t: string[]) => okAsync(t.map(() => unit)) },
      50,
    )
    const cited = await withTenant(db, TENANT, async (tx) => {
      const hits = (await searchChunksBm25({ tx, query: WORD, limit: 10 }))._unsafeUnwrap()
      const ours = hits.filter((h) => h.materialId === out.materialId)
      const segOf = await chunkSegmentsFor(
        tx,
        ours.map((h) => h.chunkId),
      )
      return ours.map((h) => segOf(h.chunkId))
    })
    expect(cited.length, `hits: ${cited.length}`).toBeGreaterThan(0)
    for (const c of cited) {
      const range = c.segmentRange ?? { from: -1, to: -1 }
      expect(range.from).toBeLessThanOrEqual(27)
      expect(range.to).toBeGreaterThanOrEqual(27)
      expect(c.startMs).toBe(range.from * 3000)
      expect(c.endMs).toBe(range.to * 3000 + 2500)
    }
    // A passage that is exactly the needle's utterance names its speaker.
    const counts = await db.execute(
      sql`select count(*)::int as n from chunks where material_id = ${out.materialId}::uuid and segment_from is null`,
    )
    expect((counts.rows[0] as { n: number }).n).toBe(0)
  })
})

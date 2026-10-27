// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Database } from "@agenticmind/shared/database/client"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import {
  filterCards,
  searchCards,
  searchCardsBm25,
  upsertCards,
} from "@agenticmind/shared/database/query/knowledge/cards"
import { searchChunks, searchChunksBm25 } from "@agenticmind/shared/database/query/knowledge/chunks"
import { getCorpusRevision } from "@agenticmind/shared/database/query/knowledge/sources"
import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { runIngestionTick } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import { sourceRef } from "@agenticmind/shared/lib/knowledge/source-contract"
import { NO_SOURCE_REF, sourceRefsFor } from "@agenticmind/shared/lib/knowledge/source-refs"
import { upsertSource } from "@agenticmind/shared/lib/knowledge/source-upsert"
import { sql } from "drizzle-orm"
import { okAsync } from "neverthrow"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Only a source's current revision answers (contract 1.11.0): every retrieval
 * path over passages and cards, the optimistic lock on upsert, and the corpus
 * revision that moves with each switch — against a real Postgres.
 */

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("current revision only (real Postgres)", () => {
  const TENANT = randomUUID()
  const ACTOR = randomUUID()
  const WORD = `zq${randomUUID().replaceAll("-", "").slice(0, 10)}`
  const sources: string[] = []
  let db: Database

  // Every text embeds to the same unit vector, so vector search ranks all rows
  // equally and the assertions look only at this test's materials.
  const unit = Array.from({ length: EMBEDDING_DIMENSIONS }, (_v, i) => (i === 0 ? 1 : 0))
  const embed = (texts: string[]) => okAsync(texts.map(() => unit))
  const runner = () => {
    return { db, workerId: `test-${randomUUID()}`, embed }
  }

  const inTenant = async <T>(run: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(db, TENANT, run)

  const upsert = async (args: Parameters<typeof upsertSource>[1]) =>
    inTenant(async (tx) => {
      const out = await upsertSource({ tx, actorUuid: ACTOR, scopes: ["knowledge:write"] }, args)
      if (out.sourceId !== null && !sources.includes(out.sourceId)) {
        sources.push(out.sourceId)
      }
      return out
    })

  const materialOf = async (revisionId: string) =>
    (
      (
        await db.execute(
          sql`select material_id::text as id from source_revisions where id = ${revisionId}::uuid`,
        )
      ).rows[0] as { id: string }
    ).id

  const addCard = async (materialId: string, body: string) =>
    inTenant(async (tx) =>
      upsertCards({
        tx,
        materialId,
        items: [
          {
            kind: "fact",
            subjectType: "topic",
            subjectValue: WORD,
            body,
            confidence: 0.9,
            embedding: unit,
            embeddingModel: "test",
          },
        ],
      }),
    )

  /** Material ids each retrieval path returns, narrowed to `ours`. */
  const seenBy = async (ours: readonly string[]) =>
    inTenant(async (tx) => {
      const pick = (ids: string[]) => ids.filter((id) => ours.includes(id)).toSorted()
      const vector = await searchChunks({ tx, queryEmbedding: unit, limit: 100 })
      const bm25 = await searchChunksBm25({ tx, query: WORD, limit: 100 })
      const cards = await searchCards({ tx, queryEmbedding: unit, limit: 100 })
      const cardsBm25 = await searchCardsBm25({ tx, query: WORD, limit: 100 })
      const filtered = await Promise.all(
        ours.map(async (materialId) => filterCards({ tx, materialId })),
      )
      return {
        chunksVector: pick(vector._unsafeUnwrap().map((h) => h.materialId)),
        chunksBm25: pick(bm25._unsafeUnwrap().map((h) => h.materialId)),
        cardsVector: pick(cards._unsafeUnwrap().map((h) => h.materialId)),
        cardsBm25: pick(cardsBm25._unsafeUnwrap().map((h) => h.materialId)),
        cardsFiltered: pick(
          filtered.flatMap((f) => f._unsafeUnwrap().hits.map((h) => h.materialId)),
        ),
        cardsFilteredTotal: filtered.reduce((n, f) => n + f._unsafeUnwrap().total, 0),
      }
    })

  const onlyMaterial = (id: string) => {
    return {
      chunksVector: [id],
      chunksBm25: [id],
      cardsVector: [id],
      cardsBm25: [id],
      cardsFiltered: [id],
      cardsFilteredTotal: 1,
    }
  }

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

  it("every retrieval path returns the current revision only, never a mix", async () => {
    const id = { sourceType: "doc", externalId: `d-${randomUUID()}` }
    const v1 = await upsert({ source: id, revision: { text: `${WORD} export takes ten minutes.` } })
    if (v1.outcome !== "accepted") {
      throw new Error("expected v1 accepted")
    }
    await runIngestionTick(runner(), 50)
    const m1 = await materialOf(v1.revisionId)
    await addCard(m1, `${WORD} export takes ten minutes.`)

    const v2 = await upsert({ source: id, revision: { text: `${WORD} export takes two minutes.` } })
    if (v2.outcome !== "accepted") {
      throw new Error("expected v2 accepted")
    }
    const m2 = await materialOf(v2.revisionId)
    // v2's passages are not written until its job runs, but a card on it must not show either.
    await addCard(m2, `${WORD} export takes two minutes.`)
    expect(await seenBy([m1, m2])).toEqual(onlyMaterial(m1))

    await runIngestionTick(runner(), 50)
    expect(await seenBy([m1, m2])).toEqual(onlyMaterial(m2))
  })

  it("a material without a source is always visible", async () => {
    const material = await inTenant(async (tx) => {
      const res = await tx.execute(
        sql`insert into materials (title, source, status) values ('plain', 'manual', 'embedded') returning id::text as id`,
      )
      return (res.rows[0] as { id: string }).id
    })
    await addCard(material, `${WORD} plain material card.`)
    const seen = await seenBy([material])
    expect(seen.cardsVector).toEqual([material])
    expect(seen.cardsFilteredTotal).toBe(1)
    await db.execute(sql`delete from materials where id = ${material}::uuid`)
  })

  describe("expectedRevisionId", () => {
    it("conflicts unless it names the current revision, and stores nothing then", async () => {
      const id = { sourceType: "doc", externalId: `d-${randomUUID()}` }
      const first = await upsert({
        source: id,
        revision: { text: "one" },
        expectedRevisionId: null,
      })
      if (first.outcome !== "accepted") {
        throw new Error("expected accepted")
      }
      await runIngestionTick(runner(), 50)

      const wrong = await upsert({
        source: id,
        revision: { text: "two" },
        expectedRevisionId: randomUUID(),
      })
      expect(wrong).toEqual({
        outcome: "conflict",
        sourceId: first.sourceId,
        currentRevisionId: first.revisionId,
        materialId: null,
      })
      const expectsNone = await upsert({
        source: id,
        revision: { text: "two" },
        expectedRevisionId: null,
      })
      expect(expectsNone.outcome).toBe("conflict")
      const revisions = await db.execute(
        sql`select count(*)::int as n from source_revisions where source_id = ${first.sourceId}::uuid`,
      )
      expect((revisions.rows[0] as { n: number }).n).toBe(1)

      const right = await upsert({
        source: id,
        revision: { text: "two" },
        expectedRevisionId: first.revisionId,
      })
      expect(right.outcome).toBe("accepted")
    })

    it("expecting a revision of a source that does not exist creates nothing", async () => {
      const externalId = `d-${randomUUID()}`
      const out = await upsert({
        source: { sourceType: "doc", externalId },
        revision: { text: "x" },
        expectedRevisionId: randomUUID(),
      })
      expect(out).toEqual({
        outcome: "conflict",
        sourceId: null,
        currentRevisionId: null,
        materialId: null,
      })
      const n = await db.execute(
        sql`select count(*)::int as n from knowledge_sources where external_id = ${externalId}`,
      )
      expect((n.rows[0] as { n: number }).n).toBe(0)
    })
  })

  it("the corpus revision moves with each switch, per tenant", async () => {
    // Drain jobs earlier tests left queued, so only this test's switches count.
    await runIngestionTick(runner(), 50)
    const before = await inTenant(async (tx) => getCorpusRevision({ tx }))
    const other = await withTenant(db, randomUUID(), async (tx) => getCorpusRevision({ tx }))
    const id = { sourceType: "doc", externalId: `d-${randomUUID()}` }
    await upsert({ source: id, revision: { text: "corpus one", externalVersion: 1 } })
    await runIngestionTick(runner(), 50)
    const afterFirst = await inTenant(async (tx) => getCorpusRevision({ tx }))
    expect(afterFirst._unsafeUnwrap()).toBe(before._unsafeUnwrap() + 1)
    await upsert({ source: id, revision: { text: "corpus two", externalVersion: 2 } })
    await runIngestionTick(runner(), 50)
    const afterSecond = await inTenant(async (tx) => getCorpusRevision({ tx }))
    expect(afterSecond._unsafeUnwrap()).toBe(before._unsafeUnwrap() + 2)
    expect(other._unsafeUnwrap()).toBe(0)
  })

  it("source fields for hits and citations", async () => {
    const v = await upsert({
      source: {
        sourceType: "repo_file",
        externalId: `r-${randomUUID()}`,
        sourceUrl: "https://example.com/repo/blob/main/README.md",
        knowledgeType: "canonical",
      },
      revision: {
        text: "How the service starts.",
        occurredAt: "2026-10-01T09:00:00Z",
        provenance: { repo: "example/repo", path: "README.md", commitSha: "abc1234" },
        warnings: ["partial document"],
      },
    })
    if (v.outcome !== "accepted") {
      throw new Error("expected accepted")
    }
    await runIngestionTick(runner(), 50)
    const m = await materialOf(v.revisionId)
    const refOf = await inTenant(async (tx) => sourceRefsFor(tx, [m, randomUUID()]))
    const ref = refOf(m)
    expect(sourceRef.parse(ref)).toEqual(ref)
    expect(ref).toMatchObject({
      sourceId: v.sourceId,
      revisionId: v.revisionId,
      sourceType: "repo_file",
      isCurrent: true,
      knowledgeType: "canonical",
      occurredAt: "2026-10-01T09:00:00.000Z",
      sourceUrl: "https://example.com/repo/blob/main/README.md",
      provenance: { repo: "example/repo", path: "README.md", commitSha: "abc1234" },
      warnings: ["partial document"],
    })
    expect(refOf(randomUUID())).toEqual(NO_SOURCE_REF)
  })
})

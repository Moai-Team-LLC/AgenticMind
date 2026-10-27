// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Database } from "@agenticmind/shared/database/client"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import { searchCardsBm25, upsertCards } from "@agenticmind/shared/database/query/knowledge/cards"
import { searchChunksBm25 } from "@agenticmind/shared/database/query/knowledge/chunks"
import { getCorpusRevision } from "@agenticmind/shared/database/query/knowledge/sources"
import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { nopBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import { runIngestionTick } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import { klForget, klSetSourceAvailability } from "@agenticmind/shared/lib/knowledge/mcp-tools"
import { klForgetSourceOutput } from "@agenticmind/shared/lib/knowledge/source-contract"
import { SourceInputError, upsertSource } from "@agenticmind/shared/lib/knowledge/source-upsert"
import { sql } from "drizzle-orm"
import { okAsync } from "neverthrow"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Retraction and availability (contract 1.11.0) against a real Postgres: a
 * retracted source leaves answers at once, the purge removes what it left, a
 * repeated delivery does not bring it back, and an unavailable source is kept
 * but not answered.
 */

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("source retraction and availability (real Postgres)", () => {
  const TENANT = randomUUID()
  const ACTOR = randomUUID()
  const OTHER = randomUUID()
  const WRITE = ["knowledge:read", "knowledge:write"]
  const ADMIN = ["knowledge:read", "knowledge:write", "knowledge:admin"]
  const WORD = `zr${randomUUID().replaceAll("-", "").slice(0, 10)}`
  const sources: string[] = []
  let db: Database

  const unit = Array.from({ length: EMBEDDING_DIMENSIONS }, (_v, i) => (i === 0 ? 1 : 0))
  const embed = (texts: string[]) => okAsync(texts.map(() => unit))
  const run = async () => runIngestionTick({ db, workerId: `test-${randomUUID()}`, embed }, 50)
  const inTenant = async <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, TENANT, fn)
  const deps = (
    tx: Parameters<Parameters<typeof withTenant>[2]>[0],
    actor = ACTOR,
    scopes = ADMIN,
  ) => {
    return { tx, actorUuid: actor, scopes, blobStore: nopBlobStore }
  }

  const upsert = async (
    args: Parameters<typeof upsertSource>[1],
    actor = ACTOR,
    scopes: string[] = WRITE,
  ) =>
    inTenant(async (tx) => {
      const out = await upsertSource({ tx, actorUuid: actor, scopes }, args)
      if (out.sourceId !== null && !sources.includes(out.sourceId)) {
        sources.push(out.sourceId)
      }
      return out
    })

  const rows = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[]

  const materialsOf = async (sourceId: string) =>
    (
      await rows<{ id: string }>(
        sql`select material_id::text as id from source_revisions where source_id = ${sourceId}::uuid and material_id is not null order by revision_no`,
      )
    ).map((r) => r.id)

  /** Materials of `ours` that BM25 passage and card search return. */
  const visible = async (ours: readonly string[]) =>
    inTenant(async (tx) => {
      const chunks = await searchChunksBm25({ tx, query: WORD, limit: 100 })
      const cards = await searchCardsBm25({ tx, query: WORD, limit: 100 })
      return [
        ...chunks._unsafeUnwrap().map((h) => `chunk:${h.materialId}`),
        ...cards._unsafeUnwrap().map((h) => `card:${h.materialId}`),
      ]
        .filter((k) => ours.some((id) => k.endsWith(id)))
        .toSorted()
    })

  const withCard = async (materialId: string) =>
    inTenant(async (tx) =>
      upsertCards({
        tx,
        materialId,
        items: [
          {
            kind: "fact",
            subjectType: "topic",
            subjectValue: WORD,
            body: `${WORD} card body.`,
            confidence: 0.9,
            embedding: unit,
            embeddingModel: "test",
          },
        ],
      }),
    )

  const events = async (sourceId: string) =>
    (
      await rows<{ kind: string; reason: string | null }>(
        sql`select kind, reason from source_events where source_id = ${sourceId}::uuid order by created_at, kind`,
      )
    ).map((e) => e.kind)

  const identity = () => {
    return { sourceType: "meeting", externalId: `m-${randomUUID()}`, connectionId: "conn-a" }
  }

  const indexed = async (id: ReturnType<typeof identity>, text: string) => {
    const out = await upsert({ source: id, revision: { text: `${WORD} ${text}` } })
    await run()
    return out
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

  it("retraction hides a source at once, and the purge removes what it left", async () => {
    const id = identity()
    const v1 = await indexed(id, "first take")
    const sourceId = v1.sourceId ?? ""
    await indexed(id, "second take")
    const [m1, m2] = await materialsOf(sourceId)
    await withCard(m2 ?? "")
    expect(await visible([m1 ?? "", m2 ?? ""])).toEqual([`card:${m2}`, `chunk:${m2}`])
    const corpusBefore = (await inTenant(async (tx) => getCorpusRevision({ tx })))._unsafeUnwrap()

    const out = await inTenant(async (tx) =>
      klForget(deps(tx), {
        id: id.externalId,
        sourceType: "meeting",
        connectionId: "conn-a",
        reason: "erasure request",
      }),
    )
    expect(klForgetSourceOutput.parse(out)).toEqual(out)
    expect(out).toMatchObject({ id: id.externalId, retracted: true, sourceId })
    // Out of every answer in the same transaction, before any purge ran.
    expect(await visible([m1 ?? "", m2 ?? ""])).toEqual([])
    expect((await inTenant(async (tx) => getCorpusRevision({ tx })))._unsafeUnwrap()).toBe(
      corpusBefore + 1,
    )

    await run()
    const left = await rows<{
      revisions: number
      materials: number
      chunks: number
      cards: number
    }>(sql`
      select
        (select count(*)::int from source_revisions where source_id = ${sourceId}::uuid) as revisions,
        (select count(*)::int from materials where id in (${m1}::uuid, ${m2}::uuid)) as materials,
        (select count(*)::int from chunks where material_id in (${m1}::uuid, ${m2}::uuid)) as chunks,
        (select count(*)::int from knowledge_cards where material_id in (${m1}::uuid, ${m2}::uuid)) as cards
    `)
    expect(left[0]).toEqual({ revisions: 0, materials: 0, chunks: 0, cards: 0 })
    const source = await rows<{ title: string; tombstoned: boolean; reason: string }>(
      sql`select title, tombstoned_at is not null as tombstoned, tombstone_reason as reason from knowledge_sources where id = ${sourceId}::uuid`,
    )
    expect(source[0]).toEqual({ title: "[retracted]", tombstoned: true, reason: "erasure request" })
    expect(await events(sourceId)).toEqual(["retracted", "purged"])
  })

  it("a repeated delivery does not bring a retracted source back; an admin's allowResurrect does", async () => {
    const id = identity()
    const v1 = await indexed(id, "said once")
    const sourceId = v1.sourceId ?? ""
    await inTenant(async (tx) => klForget(deps(tx), { id: sourceId }))
    await run()

    const again = await upsert({ source: id, revision: { text: `${WORD} said again` } })
    expect(again).toEqual({ outcome: "retracted", sourceId, materialId: null })
    expect(await materialsOf(sourceId)).toEqual([])
    await expect(
      upsert({ source: id, revision: { text: "x" }, allowResurrect: true }),
    ).rejects.toThrow(SourceInputError)

    const back = await upsert(
      { source: id, revision: { text: `${WORD} back again` }, allowResurrect: true },
      ACTOR,
      ADMIN,
    )
    expect(back.outcome).toBe("accepted")
    await run()
    expect(await visible(await materialsOf(sourceId))).toHaveLength(1)
    expect(await events(sourceId)).toContain("resurrected")
  })

  it("bringing a source back before the purge ran keeps only the new revision", async () => {
    const id = identity()
    const v1 = await indexed(id, "old words")
    const sourceId = v1.sourceId ?? ""
    const [old] = await materialsOf(sourceId)
    await inTenant(async (tx) => klForget(deps(tx), { id: sourceId }))
    const back = await upsert(
      { source: id, revision: { text: `${WORD} new words` }, allowResurrect: true },
      ACTOR,
      ADMIN,
    )
    expect(back.outcome).toBe("accepted")
    await run()
    await run()
    const now = await materialsOf(sourceId)
    expect(now).not.toContain(old)
    expect(now).toHaveLength(1)
    expect(await visible(now)).toHaveLength(1)
  })

  it("a revision indexed after its source was retracted is not published", async () => {
    const id = identity()
    const v1 = await upsert({ source: id, revision: { text: `${WORD} pending` } })
    if (v1.outcome !== "accepted") {
      throw new Error("expected accepted")
    }
    const out = await inTenant(async (tx) => klForget(deps(tx), { id: v1.sourceId }))
    expect(out).toMatchObject({ retracted: true })
    // Hold the purge so the indexing job finishes first.
    await db.execute(
      sql`update ingestion_jobs set next_attempt_at = now() + interval '1 hour' where kind = 'purge_source' and source_id = ${v1.sourceId}::uuid`,
    )
    await run()
    const job = await rows<{ status: string }>(
      sql`select status from ingestion_jobs where id = ${v1.jobId}::uuid`,
    )
    expect(job[0]?.status).toBe("retracted")
    const current = await rows<{ current: string | null }>(
      sql`select current_revision_id as current from knowledge_sources where id = ${v1.sourceId}::uuid`,
    )
    expect(current[0]?.current).toBeNull()
  })

  it("retraction is idempotent; an unknown source is not retracted", async () => {
    const v1 = await indexed(identity(), "twice")
    const first = await inTenant(async (tx) => klForget(deps(tx), { id: v1.sourceId ?? "" }))
    const second = await inTenant(async (tx) => klForget(deps(tx), { id: v1.sourceId ?? "" }))
    expect(second).toMatchObject({
      retracted: true,
      tombstonedAt: (first as { tombstonedAt: string }).tombstonedAt,
    })
    const unknown = await inTenant(async (tx) =>
      klForget(deps(tx), { id: "no-such", sourceType: "meeting", connectionId: "conn-a" }),
    )
    expect(unknown).toEqual({ id: "no-such", retracted: false })
  })

  it("kl_forget refuses a source revision's material, and still deletes a plain one", async () => {
    const v1 = await indexed(identity(), "owned material")
    const [m] = await materialsOf(v1.sourceId ?? "")
    await expect(inTenant(async (tx) => klForget(deps(tx), { id: m ?? "" }))).rejects.toThrow(
      `belongs to source ${v1.sourceId}; retract the source instead`,
    )
    const plain = await inTenant(async (tx) => {
      const res = await tx.execute(
        sql`insert into materials (title, source, status) values ('plain', 'manual', 'embedded') returning id::text as id`,
      )
      return (res.rows[0] as { id: string }).id
    })
    const removed = await inTenant(async (tx) => klForget(deps(tx), { id: plain }))
    expect(removed).toMatchObject({ id: plain, removed: true })
  })

  describe("kl_set_source_availability", () => {
    const setAvailable = async (
      id: ReturnType<typeof identity>,
      available: boolean,
      actor = ACTOR,
      scopes = WRITE,
    ) =>
      inTenant(async (tx) =>
        klSetSourceAvailability(deps(tx, actor, scopes), {
          ...id,
          available,
          reason: "file moved",
        }),
      )

    it("hides and brings back a source, for its owner or an admin only", async () => {
      const id = identity()
      const v1 = await indexed(id, "repository file")
      const ms = await materialsOf(v1.sourceId ?? "")
      expect(await visible(ms)).toHaveLength(1)

      expect(await setAvailable(id, false)).toEqual({ outcome: "updated" })
      expect(await visible(ms)).toEqual([])
      expect(await setAvailable(id, false)).toEqual({ outcome: "unchanged" })
      expect(await setAvailable(id, true, OTHER)).toEqual({ outcome: "not_found" })
      expect(await setAvailable({ ...id, externalId: "unknown" }, true)).toEqual({
        outcome: "not_found",
      })
      expect(await setAvailable(id, true)).toEqual({ outcome: "updated" })
      expect(await visible(ms)).toHaveLength(1)
      expect(await setAvailable(id, false, OTHER, ADMIN)).toEqual({ outcome: "updated" })
      expect(await events(v1.sourceId ?? "")).toEqual(["unavailable", "available", "unavailable"])
    })

    it("a new revision makes an unavailable source answer again; a retracted one stays not_found", async () => {
      const id = identity()
      const v1 = await indexed(id, "before the move")
      await setAvailable(id, false)
      await indexed(id, "after the move")
      expect(await visible(await materialsOf(v1.sourceId ?? ""))).toHaveLength(1)

      await inTenant(async (tx) => klForget(deps(tx), { id: v1.sourceId ?? "" }))
      expect(await setAvailable(id, true)).toEqual({ outcome: "not_found" })
    })
  })
})

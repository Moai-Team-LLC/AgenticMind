// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Database } from "@agenticmind/shared/database/client"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { runIngestionTick } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import {
  klForget,
  klReadSource,
  klSetSourceAvailability,
} from "@agenticmind/shared/lib/knowledge/mcp-tools"
import { klReadSourceOutput } from "@agenticmind/shared/lib/knowledge/source-contract"
import { ReadSourceError } from "@agenticmind/shared/lib/knowledge/source-read"
import { upsertSource } from "@agenticmind/shared/lib/knowledge/source-upsert"
import { sql } from "drizzle-orm"
import { okAsync } from "neverthrow"
import { createHash, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * kl_read_source (contract 1.11.0) against a real Postgres: the content of any
 * cited revision reads back with a hash that matches it, in pages, and a
 * source that is not readable looks exactly like one that does not exist.
 */

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("kl_read_source (real Postgres)", () => {
  const TENANT = randomUUID()
  const ACTOR = randomUUID()
  const READ = ["knowledge:read"]
  const sources: string[] = []
  let db: Database
  const unit = Array.from({ length: EMBEDDING_DIMENSIONS }, (_v, i) => (i === 0 ? 1 : 0))
  const run = async () =>
    runIngestionTick(
      { db, workerId: `test-${randomUUID()}`, embed: (t: string[]) => okAsync(t.map(() => unit)) },
      50,
    )

  const sha = (s: string) => createHash("sha256").update(s).digest("hex")
  const deps = (tx: Parameters<Parameters<typeof withTenant>[2]>[0], scopes = READ) => {
    return { tx, actorUuid: ACTOR, scopes }
  }
  const read = async (args: Parameters<typeof klReadSource>[1], scopes = READ) =>
    withTenant(db, TENANT, async (tx) => klReadSource(deps(tx, scopes), args))

  const upsert = async (args: Parameters<typeof upsertSource>[1]) => {
    const out = await withTenant(db, TENANT, async (tx) =>
      upsertSource({ tx, actorUuid: ACTOR, scopes: ["knowledge:write", "knowledge:admin"] }, args),
    )
    if (out.outcome !== "accepted") {
      throw new Error(`expected accepted, got ${out.outcome}`)
    }
    if (!sources.includes(out.sourceId)) {
      sources.push(out.sourceId)
    }
    await run()
    return out
  }

  const identity = () => {
    return { sourceType: "doc", externalId: `d-${randomUUID()}` }
  }

  const TEXT = "First paragraph of the guide.\nSecond paragraph, with ünïcode.\nThird one."
  const SEGMENTS = [
    {
      speaker: "Interviewer",
      speakerId: "s1",
      text: "What slowed you down?",
      startMs: 0,
      endMs: 2100,
    },
    {
      speaker: "Respondent",
      speakerId: "s2",
      text: "Mostly the export step.",
      startMs: 2100,
      endMs: 4800,
    },
    { speaker: "Interviewer", speakerId: "s1", text: "How often?", startMs: 4800, endMs: 6000 },
    { speaker: "Respondent", speakerId: "s2", text: "Every week.", startMs: 6000, endMs: 7300 },
  ]

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

  it("reads a text revision whose hash matches the content returned", async () => {
    const out = await upsert({
      source: identity(),
      revision: {
        text: TEXT,
        provenance: { repo: "example/guide", commitSha: "abc1234" },
        warnings: ["partial document"],
      },
    })
    const got = await read({ sourceId: out.sourceId })
    expect(klReadSourceOutput.parse(got)).toEqual(got)
    expect(got).toMatchObject({
      found: true,
      revisionId: out.revisionId,
      isCurrent: true,
      text: TEXT,
      segments: null,
      totalChars: Array.from(TEXT).length,
      nextOffset: null,
      truncated: false,
      provenance: { repo: "example/guide", commitSha: "abc1234" },
      warnings: ["partial document"],
    })
    if (!got.found) {
      throw new Error("expected found")
    }
    expect(got.contentHash).toBe(out.contentHash)
    expect(sha(`text\u0000${got.text ?? ""}`)).toBe(got.contentHash)
  })

  it("pages a text revision by offset; the pages add up to the whole", async () => {
    const out = await upsert({ source: identity(), revision: { text: TEXT } })
    const pages: string[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const page = await read({ sourceId: out.sourceId, offset, maxChars: 20 })
      if (!page.found) {
        throw new Error("expected found")
      }
      pages.push(page.text ?? "")
      expect(page.truncated).toBe(page.nextOffset !== null)
      offset = page.nextOffset
    }
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.join("")).toBe(TEXT)
  })

  it("reads a dialogue by segment range, with speakers and timecodes", async () => {
    const out = await upsert({ source: identity(), revision: { segments: SEGMENTS } })
    const middle = await read({ sourceId: out.sourceId, range: { fromSegment: 1, toSegment: 2 } })
    expect(middle).toMatchObject({
      found: true,
      text: null,
      totalSegments: 4,
      range: { fromSegment: 1, toSegment: 2 },
      nextOffset: null,
      segments: [
        {
          index: 1,
          speaker: "Respondent",
          speakerId: "s2",
          text: "Mostly the export step.",
          startMs: 2100,
          endMs: 4800,
        },
        {
          index: 2,
          speaker: "Interviewer",
          speakerId: "s1",
          text: "How often?",
          startMs: 4800,
          endMs: 6000,
        },
      ],
    })
    // A small cap pages the dialogue segment by segment.
    const capped = await read({ sourceId: out.sourceId, maxChars: 25 })
    expect(capped).toMatchObject({
      found: true,
      range: { fromSegment: 0, toSegment: 0 },
      nextOffset: 1,
      truncated: true,
    })
    // All segments read back hash to the revision's hash.
    const all = await read({ sourceId: out.sourceId })
    if (!all.found) {
      throw new Error("expected found")
    }
    const canonical = JSON.stringify(
      (all.segments ?? []).map((s) => [s.speaker, s.speakerId, s.text, s.startMs, s.endMs]),
    )
    expect(sha(`segments\u0000${canonical}`)).toBe(all.contentHash)
  })

  it("reads the exact revision an old citation names after the source changed", async () => {
    const id = identity()
    const v1 = await upsert({ source: id, revision: { text: "Price is set per seat." } })
    await upsert({ source: id, revision: { text: "Price is set per workspace." } })
    const old = await read({ sourceId: v1.sourceId, revisionId: v1.revisionId })
    expect(old).toMatchObject({ found: true, isCurrent: false, text: "Price is set per seat." })
    const now = await read({ sourceId: v1.sourceId })
    expect(now).toMatchObject({ found: true, isCurrent: true, text: "Price is set per workspace." })
  })

  it("not there and not readable look the same", async () => {
    const a = await upsert({ source: identity(), revision: { text: "A." } })
    const b = await upsert({ source: identity(), revision: { text: "B." } })
    const hidden = identity()
    const h = await upsert({ source: hidden, revision: { text: "Hidden." } })
    await withTenant(db, TENANT, async (tx) =>
      klSetSourceAvailability(
        { tx, actorUuid: ACTOR, scopes: ["knowledge:write"] },
        { ...hidden, available: false, reason: "moved" },
      ),
    )
    const gone = await upsert({ source: identity(), revision: { text: "Gone." } })
    await withTenant(db, TENANT, async (tx) =>
      klForget({ tx, actorUuid: ACTOR, scopes: ["knowledge:admin"] }, { id: gone.sourceId }),
    )
    const otherTenant = await withTenant(db, randomUUID(), async (tx) =>
      klReadSource(deps(tx), { sourceId: a.sourceId }),
    )
    const cases = [
      await read({ sourceId: randomUUID() }),
      await read({ sourceId: a.sourceId, revisionId: b.revisionId }),
      await read({ sourceId: h.sourceId }),
      await read({ sourceId: gone.sourceId }),
      await read({ sourceId: "not-a-uuid" }),
      otherTenant,
    ]
    expect(cases).toEqual(
      Array.from({ length: cases.length }, () => {
        return { found: false }
      }),
    )
    // Control: the readable one is found.
    expect((await read({ sourceId: a.sourceId })).found).toBe(true)
  })

  it("refuses the wrong way of paging, and a caller without knowledge:read", async () => {
    const text = await upsert({ source: identity(), revision: { text: TEXT } })
    const dialogue = await upsert({ source: identity(), revision: { segments: SEGMENTS } })
    await expect(
      read({ sourceId: text.sourceId, range: { fromSegment: 0, toSegment: 1 } }),
    ).rejects.toThrow(ReadSourceError)
    await expect(read({ sourceId: dialogue.sourceId, offset: 3 })).rejects.toThrow(
      "kl_read_source: offset applies to text revisions; read a dialogue by range",
    )
    await expect(read({ sourceId: text.sourceId }, [])).rejects.toThrow(
      "kl_read_source: missing required scope 'knowledge:read'",
    )
  })
})

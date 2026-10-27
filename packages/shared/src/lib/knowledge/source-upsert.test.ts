// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Database } from "@agenticmind/shared/database/client"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { nopBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import { runIngestionTick } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import {
  klGetIngestionStatus,
  klIngest,
  klUpsertSource,
} from "@agenticmind/shared/lib/knowledge/mcp-tools"
import { klUpsertSourceOutput } from "@agenticmind/shared/lib/knowledge/source-contract"
import {
  normalizeText,
  SourceInputError,
  upsertSource,
} from "@agenticmind/shared/lib/knowledge/source-upsert"
import { sql } from "drizzle-orm"
import { okAsync } from "neverthrow"
import { createHash, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

describe("normalizeText", () => {
  it("treats line endings, trailing spaces and composition as the same text", () => {
    expect(normalizeText("a\r\nb  \r\n")).toBe("a\nb")
    expect(normalizeText("é")).toBe("é")
    expect(normalizeText("  x\ty \t")).toBe("x\ty")
  })
})

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("source registry and upsert (real Postgres)", () => {
  const TENANT = randomUUID()
  const ACTOR = randomUUID()
  const OTHER = randomUUID()
  const WRITE = ["knowledge:read", "knowledge:write"]
  const sources: string[] = []
  let db: Database

  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)
  const embed = (texts: string[]) => okAsync(texts.map(() => vector))
  const runner = () => {
    return { db, workerId: `test-${randomUUID()}`, embed }
  }

  const upsert = async (
    args: Parameters<typeof upsertSource>[1],
    actor = ACTOR,
    scopes: string[] = WRITE,
  ) =>
    withTenant(db, TENANT, async (tx) => {
      const out = await upsertSource({ tx, actorUuid: actor, scopes }, args)
      if (!sources.includes(out.sourceId ?? "") && out.sourceId !== null) {
        sources.push(out.sourceId)
      }
      return out
    })

  const identity = () => {
    return { sourceType: "meeting", externalId: `m-${randomUUID()}`, connectionId: "conn-a" }
  }

  const one = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)).rows[0] as T

  const currentOf = async (sourceId: string) =>
    (
      await one<{ current: string | null }>(
        sql`select current_revision_id::text as current from knowledge_sources where id = ${sourceId}::uuid`,
      )
    ).current

  const revisionCount = async (sourceId: string) =>
    (
      await one<{ n: number }>(
        sql`select count(*)::int as n from source_revisions where source_id = ${sourceId}::uuid`,
      )
    ).n

  beforeAll(() => {
    db = createClient(DB_URL)
  })

  afterAll(async () => {
    // Only this file's rows: its sources (revisions and jobs cascade) and their materials.
    for (const id of sources) {
      await db.execute(
        sql`delete from materials where id in (select material_id from source_revisions where source_id = ${id}::uuid)`,
      )
      await db.execute(sql`delete from knowledge_sources where id = ${id}::uuid`)
    }
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  })

  it("a repeated delivery gives one source and one current revision", async () => {
    const id = identity()
    const delivery = { source: id, revision: { text: "Agenda.\nThe export step is slow." } }
    const first = await upsert(delivery)
    expect(first).toMatchObject({ outcome: "accepted", created: true })
    expect(klUpsertSourceOutput.parse(first)).toBeTruthy()
    const expectedHash = createHash("sha256")
      .update("text\u0000Agenda.\nThe export step is slow.")
      .digest("hex")
    expect(first.outcome === "accepted" && first.contentHash).toBe(expectedHash)

    // Delivered again while the first is still indexing: same revision, same job.
    const again = await upsert(delivery)
    expect(again.outcome).toBe("unchanged")
    if (first.outcome !== "accepted" || again.outcome !== "unchanged") {
      throw new Error("unexpected outcomes")
    }
    expect(again.revisionId).toBe(first.revisionId)
    expect(again.jobId).toBe(first.jobId)

    await runIngestionTick(runner(), 50)
    expect(await currentOf(first.sourceId)).toBe(first.revisionId)

    // Delivered once more after indexing: still unchanged, nothing left to wait for.
    const later = await upsert(delivery)
    expect(later).toMatchObject({ outcome: "unchanged", revisionId: first.revisionId, jobId: null })
    expect(await revisionCount(first.sourceId)).toBe(1)
    const n = await one<{ n: number }>(
      sql`select count(*)::int as n from knowledge_sources where connection_id = 'conn-a' and source_type = 'meeting' and external_id = ${id.externalId}`,
    )
    expect(n.n).toBe(1)
  })

  it("the same content with other line endings and trailing spaces is unchanged", async () => {
    const id = identity()
    const first = await upsert({ source: id, revision: { text: "Line one\nLine two" } })
    const again = await upsert({ source: id, revision: { text: "Line one  \r\nLine two\r\n" } })
    expect(first.outcome).toBe("accepted")
    expect(again.outcome).toBe("unchanged")
  })

  it("changed content becomes a new revision, current only once it is indexed", async () => {
    const id = identity()
    const v1 = await upsert({ source: id, revision: { text: "Price is set per seat." } })
    await runIngestionTick(runner(), 50)
    const v2 = await upsert({ source: id, revision: { text: "Price is set per workspace." } })
    if (v1.outcome !== "accepted" || v2.outcome !== "accepted") {
      throw new Error("expected two accepted revisions")
    }
    expect(v2.created).toBe(false)
    // Until v2 is searchable, v1 keeps answering.
    expect(await currentOf(v1.sourceId)).toBe(v1.revisionId)
    await runIngestionTick(runner(), 50)
    expect(await currentOf(v1.sourceId)).toBe(v2.revisionId)
    expect(await revisionCount(v1.sourceId)).toBe(2)
  })

  it("an older external version is stale and stores nothing", async () => {
    const id = identity()
    const v5 = await upsert({ source: id, revision: { text: "Fifth take.", externalVersion: 5 } })
    const v3 = await upsert({ source: id, revision: { text: "Third take.", externalVersion: 3 } })
    expect(v5.outcome).toBe("accepted")
    expect(v3).toMatchObject({ outcome: "stale", sourceId: v5.sourceId })
    expect(await revisionCount(v5.sourceId ?? "")).toBe(1)
  })

  it("a revision that finishes after a newer one became current does not take over", async () => {
    const id = identity()
    const r1 = await upsert({ source: id, revision: { text: "First.", externalVersion: 1 } })
    const r2 = await upsert({ source: id, revision: { text: "Second.", externalVersion: 2 } })
    if (r1.outcome !== "accepted" || r2.outcome !== "accepted") {
      throw new Error("expected two accepted revisions")
    }
    // r1's worker is slow: r2 is indexed first.
    await db.execute(
      sql`update ingestion_jobs set next_attempt_at = now() + interval '1 hour' where id = ${r1.jobId}::uuid`,
    )
    await runIngestionTick(runner(), 50)
    expect(await currentOf(r1.sourceId)).toBe(r2.revisionId)
    await db.execute(
      sql`update ingestion_jobs set next_attempt_at = now() where id = ${r1.jobId}::uuid`,
    )
    await runIngestionTick(runner(), 50)
    expect(await currentOf(r1.sourceId)).toBe(r2.revisionId)
    const late = await one<{ status: string }>(
      sql`select status from ingestion_jobs where id = ${r1.jobId}::uuid`,
    )
    expect(late.status).toBe("superseded")
  })

  it("the same identity in another tenant is that tenant's own source", async () => {
    const id = identity()
    const mine = await upsert({ source: id, revision: { text: "Ours." } })
    const theirs = await withTenant(db, randomUUID(), async (tx) =>
      upsertSource(
        { tx, actorUuid: OTHER, scopes: WRITE },
        { source: id, revision: { text: "Theirs." } },
      ),
    )
    if (theirs.sourceId !== null) {
      sources.push(theirs.sourceId)
    }
    expect(theirs).toMatchObject({ outcome: "accepted", created: true })
    expect(theirs.sourceId).not.toBe(mine.sourceId)
  })

  it("concurrent first deliveries create one source", async () => {
    const id = identity()
    const delivery = { source: id, revision: { text: "Same content, twice at once." } }
    const outs = await Promise.all([upsert(delivery), upsert(delivery)])
    expect(outs.map((o) => o.outcome).toSorted()).toEqual(["accepted", "unchanged"])
    expect(outs[0]?.sourceId).toBe(outs[1]?.sourceId)
    expect(await revisionCount(outs[0]?.sourceId ?? "")).toBe(1)
  })

  it("concurrent changed deliveries of one source get distinct revision numbers", async () => {
    const id = identity()
    await upsert({ source: id, revision: { text: "Base." } })
    const outs = await Promise.all(
      ["Edit A.", "Edit B.", "Edit C."].map(async (text) =>
        upsert({ source: id, revision: { text } }),
      ),
    )
    expect(outs.map((o) => o.outcome)).toEqual(["accepted", "accepted", "accepted"])
    const nos = await db.execute(
      sql`select revision_no from source_revisions where source_id = ${outs[0]?.sourceId}::uuid order by revision_no`,
    )
    expect((nos.rows as { revision_no: number }[]).map((r) => r.revision_no)).toEqual([1, 2, 3, 4])
  })

  it("a dialogue is indexed as speaker lines", async () => {
    const out = await upsert({
      source: identity(),
      revision: {
        segments: [
          { speaker: "Interviewer", text: "What slowed you down?", startMs: 0, endMs: 2100 },
          { speaker: "Respondent", text: "Mostly the export step.", startMs: 2100, endMs: 4800 },
        ],
      },
    })
    if (out.outcome !== "accepted") {
      throw new Error("expected accepted")
    }
    const rev = await one<{ text: string; segments: unknown[] }>(
      sql`select content_text as text, segments from source_revisions where id = ${out.revisionId}::uuid`,
    )
    expect(rev.text).toBe("Interviewer: What slowed you down?\nRespondent: Mostly the export step.")
    expect(rev.segments).toHaveLength(2)
    await runIngestionTick(runner(), 50)
    const chunk = await one<{ body: string }>(
      sql`select string_agg(body, ' ') as body from chunks where material_id = (select material_id from source_revisions where id = ${out.revisionId}::uuid)`,
    )
    expect(chunk.body).toContain("Respondent: Mostly the export step.")
  })

  describe("refusals", () => {
    const refused = async (run: () => Promise<unknown>, message: string) => {
      let caught: unknown = null
      try {
        await run()
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(SourceInputError)
      expect((caught as Error).message).toBe(message)
    }

    it("visibility other than workspace, and recipients", async () => {
      await refused(
        async () =>
          upsert({ source: { ...identity(), visibility: "restricted" }, revision: { text: "x" } }),
        "visibility 'restricted' is not supported by this server yet — only 'workspace' sources are stored until per-document access control ships",
      )
      await refused(
        async () =>
          upsert({ source: { ...identity(), recipients: ["p-1"] }, revision: { text: "x" } }),
        "recipients need 'restricted' or 'personal' visibility, which this server does not support yet",
      )
      const ok = await upsert({
        source: { ...identity(), visibility: "workspace" },
        revision: { text: "x" },
      })
      expect(ok.outcome).toBe("accepted")
    })

    it("another writer's source, unless admin", async () => {
      const id = identity()
      await upsert({ source: id, revision: { text: "Owned." } })
      await refused(
        async () => upsert({ source: id, revision: { text: "Taken over." } }, OTHER),
        "the source belongs to another principal",
      )
      const admin = await upsert({ source: id, revision: { text: "Fixed by an admin." } }, OTHER, [
        "knowledge:write",
        "knowledge:admin",
      ])
      expect(admin.outcome).toBe("accepted")
    })

    it("both or neither of text and segments, and oversized dialogues", async () => {
      await refused(
        async () =>
          upsert({ source: identity(), revision: { text: "a", segments: [{ text: "b" }] } }),
        "revision needs exactly one of 'text' and 'segments'",
      )
      await refused(
        async () => upsert({ source: identity(), revision: {} }),
        "revision needs exactly one of 'text' and 'segments'",
      )
      const big = Array.from({ length: 11 }, () => {
        return { text: "x".repeat(20_000) }
      })
      await refused(
        async () => upsert({ source: identity(), revision: { segments: big } }),
        "segments carry 220000 characters; a revision holds at most 200000",
      )
    })
  })

  describe("MCP handlers", () => {
    const deps = (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => {
      return { tx, actorUuid: ACTOR, scopes: WRITE, blobStore: nopBlobStore }
    }

    it("kl_ingest with a source is idempotent and answers the upsert envelope", async () => {
      const id = identity()
      const call = async () =>
        withTenant(db, TENANT, async (tx) =>
          klIngest(deps(tx), {
            title: "Weekly notes",
            text: "Decided to ship on Friday.",
            source: id,
          }),
        )
      const first = (await call()) as { outcome: string; sourceId: string; materialId: string }
      sources.push(first.sourceId)
      const second = (await call()) as { outcome: string; materialId: string }
      expect(first.outcome).toBe("accepted")
      expect(second.outcome).toBe("unchanged")
      expect(second.materialId).toBe(first.materialId)
    })

    it("kl_upsert_source refuses with the tool name, and the job reports its source", async () => {
      await expect(
        withTenant(db, TENANT, async (tx) =>
          klUpsertSource(deps(tx), {
            source: { ...identity(), visibility: "personal" },
            revision: { text: "x" },
          }),
        ),
      ).rejects.toThrow("kl_upsert_source: visibility 'personal' is not supported")

      const out = await withTenant(db, TENANT, async (tx) =>
        klUpsertSource(deps(tx), { source: identity(), revision: { text: "Status check." } }),
      )
      expect("materialId" in out).toBe(false)
      if (out.outcome !== "accepted") {
        throw new Error("expected accepted")
      }
      sources.push(out.sourceId)
      await runIngestionTick(runner(), 50)
      const status = await withTenant(db, TENANT, async (tx) =>
        klGetIngestionStatus(deps(tx), { jobId: out.jobId }),
      )
      expect(status).toMatchObject({
        found: true,
        status: "ready",
        sourceId: out.sourceId,
        revisionId: out.revisionId,
        isCurrent: true,
      })
    })
  })
})

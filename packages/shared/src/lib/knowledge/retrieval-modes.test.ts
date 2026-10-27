// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Database } from "@agenticmind/shared/database/client"
import type { RetrievalScope } from "@agenticmind/shared/database/query/knowledge/retrievable"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import { searchCardsBm25, upsertCards } from "@agenticmind/shared/database/query/knowledge/cards"
import { searchChunksBm25 } from "@agenticmind/shared/database/query/knowledge/chunks"
import { isScoped } from "@agenticmind/shared/database/query/knowledge/retrievable"
import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { runIngestionTick } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import {
  citationKnowledgeType,
  formatOriginNote,
  NO_SOURCE_REF,
} from "@agenticmind/shared/lib/knowledge/source-refs"
import { upsertSource } from "@agenticmind/shared/lib/knowledge/source-upsert"
import { sql } from "drizzle-orm"
import { okAsync } from "neverthrow"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Retrieval modes and knowledge types (contract 1.11.0): a question about the
 * rule in force does not get a hypothesis from an interview; research sees
 * every type, labelled; history sees superseded revisions; sourceTypes and
 * period narrow — on passages and cards alike.
 */

describe("knowledge type labels", () => {
  it("a card drawn from evidence without a verbatim span is an inference", () => {
    expect(citationKnowledgeType("card", "evidence", null)).toBe("inference")
    expect(citationKnowledgeType("card", "evidence", 12)).toBe("evidence")
    expect(citationKnowledgeType("chunk", "evidence", null)).toBe("evidence")
    expect(citationKnowledgeType("card", "canonical", null)).toBe("canonical")
  })

  it("the prompt says what a non-canonical source stands for", () => {
    expect(formatOriginNote({ ...NO_SOURCE_REF, knowledgeType: "evidence" })).toBe(
      "{evidence: what was said, not established fact}",
    )
    expect(formatOriginNote({ ...NO_SOURCE_REF, knowledgeType: "inference" })).toBe(
      "{inference: produced by a model}",
    )
    expect(formatOriginNote(NO_SOURCE_REF)).toBe("")
  })

  it("only a real narrowing counts as scoped (the answer cache stays usable otherwise)", () => {
    expect(isScoped()).toBe(false)
    expect(isScoped({})).toBe(false)
    expect(isScoped({ sourceTypes: [] })).toBe(false)
    expect(isScoped({ mode: "current" })).toBe(true)
    expect(isScoped({ period: { from: "2026-01-01T00:00:00Z" } })).toBe(true)
  })
})

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("retrieval modes (real Postgres)", () => {
  const TENANT = randomUUID()
  const ACTOR = randomUUID()
  const WORD = `zm${randomUUID().replaceAll("-", "").slice(0, 10)}`
  const sources: string[] = []
  const plain: string[] = []
  let db: Database
  const unit = Array.from({ length: EMBEDDING_DIMENSIONS }, (_v, i) => (i === 0 ? 1 : 0))
  const m: Record<string, string> = {}

  const upsert = async (args: Parameters<typeof upsertSource>[1]) => {
    const out = await withTenant(db, TENANT, async (tx) =>
      upsertSource({ tx, actorUuid: ACTOR, scopes: ["knowledge:write"] }, args),
    )
    if (out.outcome !== "accepted") {
      throw new Error(`expected accepted, got ${out.outcome}`)
    }
    sources.push(out.sourceId)
    await runIngestionTick(
      { db, workerId: `test-${randomUUID()}`, embed: (t: string[]) => okAsync(t.map(() => unit)) },
      50,
    )
    return out.materialId ?? ""
  }

  const plainMaterial = async (lifecycle: string, text: string) => {
    const id = await withTenant(db, TENANT, async (tx) => {
      const res = await tx.execute(
        sql`insert into materials (title, source, status, lifecycle) values ('plain', 'manual', 'embedded', ${lifecycle}) returning id::text as id`,
      )
      const materialId = (res.rows[0] as { id: string }).id
      await tx.execute(
        sql`insert into chunks (material_id, ordinal, body, body_tsv) values (${materialId}::uuid, 0, ${text}, to_tsvector('simple', ${text}))`,
      )
      return materialId
    })
    plain.push(id)
    return id
  }

  const addCard = async (materialId: string) =>
    withTenant(db, TENANT, async (tx) =>
      upsertCards({
        tx,
        materialId,
        items: [
          {
            kind: "fact",
            subjectType: "topic",
            subjectValue: WORD,
            body: `${WORD} card.`,
            confidence: 0.9,
          },
        ],
      }),
    )

  /** Names of this test's materials each path returns under `scope`. */
  const seen = async (scope: RetrievalScope) =>
    withTenant(db, TENANT, async (tx) => {
      const names = new Map(Object.entries(m).map(([name, id]) => [id, name]))
      const chunks = (
        await searchChunksBm25({ tx, query: WORD, limit: 100, scope })
      )._unsafeUnwrap()
      const cards = (await searchCardsBm25({ tx, query: WORD, limit: 100, scope }))._unsafeUnwrap()
      const pick = (ids: string[]) =>
        [
          ...new Set(ids.map((id) => names.get(id)).filter((n): n is string => n !== undefined)),
        ].toSorted()
      return {
        chunks: pick(chunks.map((h) => h.materialId)),
        cards: pick(cards.map((h) => h.materialId)),
      }
    })

  const both = (names: string[]) => {
    const sorted = names.toSorted()
    return { chunks: sorted, cards: sorted }
  }

  beforeAll(async () => {
    db = createClient(DB_URL)
    const docId = { sourceType: "repo_file", externalId: `d-${randomUUID()}` }
    m.oldRule = await upsert({
      source: { ...docId, knowledgeType: "canonical" },
      revision: {
        text: `${WORD} old rule: price is set per seat.`,
        occurredAt: "2025-12-01T00:00:00Z",
      },
    })
    m.rule = await upsert({
      source: docId,
      revision: {
        text: `${WORD} rule: price is set per workspace.`,
        occurredAt: "2026-01-10T00:00:00Z",
      },
    })
    m.interview = await upsert({
      source: { sourceType: "meeting", externalId: `m-${randomUUID()}`, knowledgeType: "evidence" },
      revision: {
        text: `${WORD} respondent thinks price should be per seat.`,
        occurredAt: "2026-06-01T00:00:00Z",
      },
    })
    m.summary = await upsert({
      source: {
        sourceType: "summary",
        externalId: `s-${randomUUID()}`,
        knowledgeType: "inference",
      },
      revision: {
        text: `${WORD} summary suggests per-seat pricing.`,
        occurredAt: "2026-06-02T00:00:00Z",
      },
    })
    m.legacy = await plainMaterial("active", `${WORD} legacy note about pricing.`)
    m.archived = await plainMaterial("archived", `${WORD} archived note about pricing.`)
    for (const id of Object.values(m)) {
      await addCard(id)
    }
  })

  afterAll(async () => {
    for (const id of sources) {
      await db.execute(
        sql`delete from materials where id in (select material_id from source_revisions where source_id = ${id}::uuid)`,
      )
      await db.execute(sql`delete from knowledge_sources where id = ${id}::uuid`)
    }
    for (const id of plain) {
      await db.execute(sql`delete from materials where id = ${id}::uuid`)
    }
    await db.execute(sql`delete from knowledge_corpus where tenant_id = ${TENANT}::uuid`)
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  })

  it("mode omitted: current revisions, every type — as before", async () => {
    expect(await seen({})).toEqual(both(["rule", "interview", "summary", "legacy", "archived"]))
  })

  it("current: the rule in force only — no interview hypothesis, no model summary, nothing archived", async () => {
    expect(await seen({ mode: "current" })).toEqual(both(["rule", "legacy"]))
  })

  it("research: every type of the current revisions", async () => {
    expect(await seen({ mode: "research" })).toEqual(
      both(["rule", "interview", "summary", "legacy", "archived"]),
    )
  })

  it("history: superseded revisions too", async () => {
    expect(await seen({ mode: "history" })).toEqual(
      both(["oldRule", "rule", "interview", "summary", "legacy", "archived"]),
    )
  })

  it("sourceTypes and period narrow on passages and cards", async () => {
    expect(await seen({ sourceTypes: ["meeting"] })).toEqual(both(["interview"]))
    expect(await seen({ mode: "history", sourceTypes: ["repo_file"] })).toEqual(
      both(["oldRule", "rule"]),
    )
    expect(
      await seen({
        mode: "history",
        period: { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" },
      }),
    ).toEqual(both(["rule"]))
  })
})

// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Database } from "@agenticmind/shared/database/client"
import type { Source } from "@agenticmind/shared/lib/knowledge/synth"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { runIngestionTick } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import {
  annotateOrigins,
  formatOriginNote,
  NO_SOURCE_REF,
} from "@agenticmind/shared/lib/knowledge/source-refs"
import { upsertSource } from "@agenticmind/shared/lib/knowledge/source-upsert"
import { buildPrompt, ORIGIN_INSTRUCTION } from "@agenticmind/shared/lib/knowledge/synth"
import { sql } from "drizzle-orm"
import { okAsync } from "neverthrow"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Provenance reaches the answer (contract 1.11.0): the synthesis prompt shows
 * each source's repository, commit, environment, date and limits, and tells the
 * model to rest a claim about a running system on the environment it names —
 * while a prompt over materials without a source stays exactly as before.
 */

const source = (over: Partial<Source>): Source => {
  return {
    number: 1,
    chunkId: "c1",
    materialId: "m1",
    title: "Service guide",
    body: "The export runs nightly.",
    score: 1,
    updatedAt: null,
    origin: "chunk",
    ...over,
  }
}

describe("origin note", () => {
  it("names repository, commit, environment, date and limits", () => {
    expect(
      formatOriginNote({
        ...NO_SOURCE_REF,
        provenance: {
          repo: "example/service",
          path: "docs/export.md",
          commitSha: "abc1234",
          environment: "production",
        },
        occurredAt: "2026-10-01T09:00:00.000Z",
        warnings: ["partial document"],
      }),
    ).toBe(
      "{repo example/service, path docs/export.md, commit abc1234, environment production; occurred 2026-10-01; limits: partial document}",
    )
    expect(formatOriginNote(NO_SOURCE_REF)).toBe("")
  })

  it("puts the note and the instruction in the prompt only when a source states its origin", () => {
    const plain = buildPrompt("Does the export run in production?", [source({})])
    expect(plain).not.toContain(ORIGIN_INSTRUCTION)
    expect(plain).toBe(
      "Sources:\n[1] Service guide\nThe export runs nightly.\n\nQuestion: Does the export run in production?\n\nAnswer:",
    )
    const noted = buildPrompt("Does the export run in production?", [
      source({ originNote: "{commit abc1234, environment staging}" }),
    ])
    expect(noted).toContain(ORIGIN_INSTRUCTION)
    expect(noted).toContain("[1] Service guide {commit abc1234, environment staging}")
  })
})

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("origin notes from the source registry (real Postgres)", () => {
  const TENANT = randomUUID()
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

  it("a source's commit and environment reach the prompt the model answers from", async () => {
    const out = await withTenant(db, TENANT, async (tx) =>
      upsertSource(
        { tx, actorUuid: randomUUID(), scopes: ["knowledge:write"] },
        {
          source: { sourceType: "repo_file", externalId: `r-${randomUUID()}` },
          revision: {
            text: "The export runs nightly.",
            provenance: { repo: "example/service", commitSha: "def5678", environment: "staging" },
          },
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
    const items = [
      source({ materialId: out.materialId ?? "" }),
      source({ number: 2, materialId: randomUUID() }),
    ]
    await withTenant(db, TENANT, async (tx) => annotateOrigins(tx, items))
    expect(items[0]?.originNote).toBe("{repo example/service, commit def5678, environment staging}")
    expect(items[1]?.originNote).toBeUndefined()
    const prompt = buildPrompt("Does the export run in production?", items)
    expect(prompt).toContain("commit def5678, environment staging")
    expect(prompt).toContain(ORIGIN_INSTRUCTION)
  })
})

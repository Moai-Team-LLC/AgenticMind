// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Database } from "@agenticmind/shared/database/client"
import type { CardsExtractError } from "@agenticmind/shared/lib/knowledge/cards-extractor"
import type { KnowledgeAiError } from "@agenticmind/shared/lib/knowledge/llm"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import { claimIngestionJobs } from "@agenticmind/shared/database/query/knowledge/ingestion-jobs"
import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { nopBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import { ingestText } from "@agenticmind/shared/lib/knowledge/ingest"
import {
  INGESTION_ERROR_MESSAGES,
  retryDelaySeconds,
  runIngestionTick,
} from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import { klGetIngestionStatus } from "@agenticmind/shared/lib/knowledge/mcp-tools"
import { klGetIngestionStatusOutput } from "@agenticmind/shared/lib/knowledge/source-contract"
import { sql } from "drizzle-orm"
import { errAsync, okAsync, ResultAsync } from "neverthrow"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Background ingestion (contract 1.11.0) against a real Postgres: the request
 * budget, async idempotency, lease takeover, retry/backoff, status visibility
 * and the job's tenant. Model calls are injected fakes; everything else — the
 * job table, its lease SQL, passages and cards — is the real thing.
 */

describe("retryDelaySeconds", () => {
  it("doubles per attempt within ±20% jitter and caps at an hour", () => {
    expect(retryDelaySeconds(1, () => 0.5)).toBe(30)
    expect(retryDelaySeconds(2, () => 0.5)).toBe(60)
    expect(retryDelaySeconds(3, () => 0)).toBe(96)
    expect(retryDelaySeconds(3, () => 0.999)).toBe(144)
    expect(retryDelaySeconds(20, () => 0.5)).toBe(3600)
  })
})

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("background ingestion (real Postgres)", () => {
  const TENANT = randomUUID()
  const ACTOR = randomUUID()
  const OTHER = randomUUID()
  const created: string[] = []
  let db: Database

  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)
  const embed = (texts: string[]) => okAsync(texts.map(() => vector))
  const failingEmbed = () =>
    errAsync<number[][], KnowledgeAiError>({
      type: "ai_error",
      message: "provider exploded: secret-detail-123",
      originalError: null,
    })

  const card = {
    kind: "fact" as const,
    subjectType: "topic",
    subjectValue: "export",
    body: "The export step is the slowest part of the setup.",
    confidence: 0.9,
  }
  const workingExtract = () => okAsync([card])
  const failingExtract = () =>
    errAsync<never, CardsExtractError>({ type: "llm_error", message: "schema mismatch" })

  const TEXT =
    "Interview notes. The export step is the slowest part of the setup. " +
    "Everything else took a few minutes."

  const track = (materialId: string): string => {
    created.push(materialId)
    return materialId
  }

  const count = async (table: "chunks" | "knowledge_cards", materialId: string) => {
    const res = await db.execute(
      sql`select count(*)::int as n, min(tenant_id::text) as tenant from ${sql.identifier(table)} where material_id = ${materialId}::uuid`,
    )
    return res.rows[0] as { n: number; tenant: string | null }
  }

  const job = async (id: string) => {
    const res = await db.execute(sql`select * from ingestion_jobs where id = ${id}::uuid`)
    return res.rows[0] as {
      status: string
      stage: string
      attempts: number
      error_code: string | null
      error_message: string | null
      coverage: { processedChars: number; totalChars: number } | null
      payload: Record<string, unknown>
      next_attempt_at: Date
      tenant_id: string
    }
  }

  /** Makes a job due now (as if its backoff elapsed). Touches only this test's row. */
  const makeDue = async (id: string) =>
    db.execute(sql`update ingestion_jobs set next_attempt_at = now() where id = ${id}::uuid`)

  const ingest = async (props: Partial<Parameters<typeof ingestText>[0]>) =>
    withTenant(db, TENANT, async (tx) =>
      ingestText({
        tx,
        blobStore: nopBlobStore,
        title: `b1-${randomUUID()}`,
        text: TEXT,
        createdBy: ACTOR,
        embed,
        ...props,
      }),
    )

  const runner = (overrides: Partial<Parameters<typeof runIngestionTick>[0]> = {}) => {
    return {
      db,
      workerId: `test-${randomUUID()}`,
      embed,
      extractCards: workingExtract,
      ...overrides,
    }
  }

  beforeAll(() => {
    db = createClient(DB_URL)
  })

  afterAll(async () => {
    // Remove only what this file created: its materials (jobs, passages and cards cascade).
    for (const id of created) {
      await db.execute(sql`delete from materials where id = ${id}::uuid`)
    }
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  })

  it("a synchronous ingest whose card step outlasts the budget answers text_ready with a job", async () => {
    let aborted = false
    const hangingExtract = (p: { abortSignal?: AbortSignal }) =>
      ResultAsync.fromPromise(
        new Promise<never>((_resolve, reject) => {
          p.abortSignal?.addEventListener("abort", () => {
            aborted = true
            reject(new Error("aborted"))
          })
        }),
        (e): CardsExtractError => {
          return { type: "llm_error", message: String(e) }
        },
      )
    const started = Date.now()
    const res = await ingest({ cardsEnabled: true, budgetMs: 300, extractCards: hangingExtract })
    const elapsed = Date.now() - started
    expect(res.isOk(), res.isErr() ? res.error.message : "").toBe(true)
    const out = res._unsafeUnwrap()
    track(out.materialId)
    expect(out.status).toBe("text_ready")
    expect(out.jobId).not.toBeNull()
    expect(out.chunkCount).toBeGreaterThan(0)
    expect(elapsed, `took ${elapsed} ms`).toBeLessThan(3000)
    expect(aborted).toBe(true)
    expect((await count("chunks", out.materialId)).n).toBe(out.chunkCount)

    // The job builds the cards the request could not wait for.
    const ran = await runIngestionTick(runner(), 10)
    expect(ran).toBeGreaterThan(0)
    const done = await job(out.jobId ?? "")
    expect(done.status).toBe("ready")
    expect(done.stage).toBe("done")
    expect(done.payload.text).toBeUndefined()
    expect(done.coverage?.totalChars).toBe(Array.from(TEXT).length)
    expect((await count("knowledge_cards", out.materialId)).n).toBe(1)
  })

  it("control: a synchronous ingest that fits the budget is ready with no job", async () => {
    const res = await ingest({ cardsEnabled: true, budgetMs: 10_000, extractCards: workingExtract })
    const out = res._unsafeUnwrap()
    track(out.materialId)
    expect(out.status).toBe("ready")
    expect(out.jobId).toBeNull()
    expect((await count("knowledge_cards", out.materialId)).n).toBe(1)
  })

  it("an async ingest returns a queued job at once, and a repeated delivery finds the same job", async () => {
    const title = `b1-async-${randomUUID()}`
    const first = (await ingest({ title, async: true }))._unsafeUnwrap()
    track(first.materialId)
    const second = (await ingest({ title, async: true }))._unsafeUnwrap()
    expect(first.status).toBe("queued")
    expect(first.jobId).not.toBeNull()
    expect(second.jobId).toBe(first.jobId)
    expect(second.materialId).toBe(first.materialId)
    const mats = await db.execute(
      sql`select count(*)::int as n from materials where title = ${title}`,
    )
    expect((mats.rows[0] as { n: number }).n).toBe(1)
    expect((await count("chunks", first.materialId)).n).toBe(0)
  })

  it("the same async ingest in another tenant is that tenant's own job", async () => {
    const title = `b1-cross-${randomUUID()}`
    const mine = (await ingest({ title, async: true }))._unsafeUnwrap()
    track(mine.materialId)
    const theirs = (
      await withTenant(db, randomUUID(), async (tx) =>
        ingestText({
          tx,
          blobStore: nopBlobStore,
          title,
          text: TEXT,
          createdBy: ACTOR,
          async: true,
        }),
      )
    )._unsafeUnwrap()
    track(theirs.materialId)
    expect(theirs.jobId).not.toBe(mine.jobId)
    expect(theirs.materialId).not.toBe(mine.materialId)
  })

  it("a job whose worker died is resumed by another once the lease expires", async () => {
    const out = (await ingest({ async: true }))._unsafeUnwrap()
    track(out.materialId)
    const jobId = out.jobId ?? ""
    // Worker A claims and "crashes": it never runs the job.
    const claimedByA = await claimIngestionJobs({
      tx: db,
      owner: "dead-worker",
      limit: 50,
      leaseSeconds: 120,
    })
    expect(claimedByA._unsafeUnwrap().map((j) => j.id)).toContain(jobId)
    // While A's lease holds, nobody else gets the job.
    const blocked = await claimIngestionJobs({ tx: db, owner: "b", limit: 50, leaseSeconds: 120 })
    expect(blocked._unsafeUnwrap().map((j) => j.id)).not.toContain(jobId)
    // A's lease runs out (simulated on this row only); worker B resumes and finishes.
    await db.execute(
      sql`update ingestion_jobs set lease_expires_at = now() - interval '1 second' where id = ${jobId}::uuid`,
    )
    await runIngestionTick(runner(), 50)
    const done = await job(jobId)
    expect(done.status).toBe("ready")
    expect(done.attempts).toBe(2)
    const chunks = await count("chunks", out.materialId)
    expect(chunks.n).toBeGreaterThan(0)
    // Running it again changes nothing: passages are replaced, not duplicated.
    await db.execute(
      sql`update ingestion_jobs set stage = 'index', status = 'queued' where id = ${jobId}::uuid`,
    )
    await runIngestionTick(runner(), 50)
    expect((await count("chunks", out.materialId)).n).toBe(chunks.n)
  })

  it("a failing stage waits with backoff, then fails with a safe message after max attempts", async () => {
    const out = (await ingest({ async: true }))._unsafeUnwrap()
    track(out.materialId)
    const jobId = out.jobId ?? ""
    const failing = runner({ embed: failingEmbed })
    await runIngestionTick(failing, 50)
    const waiting = await job(jobId)
    expect(waiting.status).toBe("retry_wait")
    expect(waiting.error_code).toBe("embedding_failed")
    expect(new Date(waiting.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 10_000)
    // Not due yet: another tick leaves it alone.
    await runIngestionTick(failing, 50)
    expect((await job(jobId)).attempts).toBe(1)
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await makeDue(jobId)
      await runIngestionTick(failing, 50)
    }
    const failed = await job(jobId)
    expect(failed.status).toBe("failed")
    expect(failed.attempts).toBe(5)
    expect(failed.error_message).toBe(INGESTION_ERROR_MESSAGES.embedding_failed)
    expect(failed.error_message).not.toContain("secret-detail")
  })

  it("a card failure after the passages exist keeps them searchable and says so", async () => {
    const out = (await ingest({ async: true, cardsEnabled: true }))._unsafeUnwrap()
    track(out.materialId)
    await runIngestionTick(runner({ extractCards: failingExtract }), 50)
    const j = await job(out.jobId ?? "")
    expect(j.status).toBe("text_ready")
    expect(j.stage).toBe("cards")
    expect(j.error_code).toBe("cards_failed")
    expect((await count("chunks", out.materialId)).n).toBeGreaterThan(0)
  })

  it("runs every stage under the job's own tenant", async () => {
    const tenant = randomUUID()
    const out = (
      await withTenant(db, tenant, async (tx) =>
        ingestText({
          tx,
          blobStore: nopBlobStore,
          title: `b1-tenant-${randomUUID()}`,
          text: TEXT,
          createdBy: ACTOR,
          async: true,
        }),
      )
    )._unsafeUnwrap()
    track(out.materialId)
    expect((await job(out.jobId ?? "")).tenant_id).toBe(tenant)
    await runIngestionTick(runner(), 50)
    const chunks = await count("chunks", out.materialId)
    expect(chunks.n).toBeGreaterThan(0)
    expect(chunks.tenant).toBe(tenant)
  })

  describe("kl_get_ingestion_status", () => {
    const status = async (jobId: string, actorUuid: string, scopes: string[]) =>
      withTenant(db, TENANT, async (tx) =>
        klGetIngestionStatus({ tx, actorUuid, scopes }, { jobId }),
      )

    it("shows a job to its creator and to admins, and nothing to anyone else", async () => {
      const out = (await ingest({ async: true }))._unsafeUnwrap()
      track(out.materialId)
      const jobId = out.jobId ?? ""

      const mine = await status(jobId, ACTOR, ["knowledge:read", "knowledge:write"])
      expect(klGetIngestionStatusOutput.parse(mine)).toEqual(mine)
      expect(mine).toMatchObject({
        found: true,
        jobId,
        status: "queued",
        materialId: out.materialId,
      })

      expect(await status(jobId, OTHER, ["knowledge:read", "knowledge:write"])).toEqual({
        found: false,
      })
      expect(await status(jobId, OTHER, ["knowledge:write", "knowledge:admin"])).toMatchObject({
        found: true,
        jobId,
      })
      expect(await status(randomUUID(), ACTOR, ["knowledge:write"])).toEqual({ found: false })
      await expect(status(jobId, ACTOR, ["knowledge:read"])).rejects.toThrow(
        "missing required scope 'knowledge:write'",
      )
    })
  })
})

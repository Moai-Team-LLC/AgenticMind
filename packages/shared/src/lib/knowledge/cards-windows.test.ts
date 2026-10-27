// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Database } from "@agenticmind/shared/database/client"
import type { CardInput } from "@agenticmind/shared/database/query/knowledge/cards"
import type { CardsExtractError } from "@agenticmind/shared/lib/knowledge/cards-extractor"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { chatModel, structuredOutputsEnabled } from "@agenticmind/shared/lib/ai/chat"
import { nopBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import { CARDS_MAX_BODY_CHARS } from "@agenticmind/shared/lib/knowledge/card"
import { cardWindows, computeCardItems } from "@agenticmind/shared/lib/knowledge/indexer"
import { ingestText } from "@agenticmind/shared/lib/knowledge/ingest"
import { runIngestionTick } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import { activeProfile } from "@agenticmind/shared/lib/profile"
import { aiSettings } from "@agenticmind/shared/settings/ai-settings"
import { sql } from "drizzle-orm"
import { errAsync, okAsync } from "neverthrow"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Cards over the whole document (contract 1.11.0): windows cover every
 * character, a fact from the end of a long text becomes a card, duplicates on
 * a seam merge, spans point into the whole text, a failed window is counted,
 * and the JSON schema reaches the endpoint when structured outputs are on.
 */

const NEEDLE = "The renewal discount ends on the last day of the quarter."
const filler = (i: number) => `Line ${i}: routine notes about the weekly meeting and the agenda.`
const longText = (lines: number, needleAt: number) =>
  Array.from({ length: lines }, (_v, i) => (i === needleAt ? NEEDLE : filler(i))).join("\n")

const card = (body: string, over: Partial<CardInput> = {}): CardInput => {
  return {
    kind: "fact",
    subjectType: "topic",
    subjectValue: "renewal",
    body,
    confidence: 0.8,
    ...over,
  }
}

/** Like the real extractor: it reads only the first CARDS_MAX_BODY_CHARS characters. */
const extractorSeeing = (failOn?: (body: string) => boolean) => {
  const calls: string[] = []
  const extract = (p: { body: string }) => {
    calls.push(p.body)
    if (failOn?.(p.body) === true) {
      return errAsync<CardInput[], CardsExtractError>({
        type: "llm_error",
        message: "schema mismatch",
      })
    }
    const seen = Array.from(p.body).slice(0, CARDS_MAX_BODY_CHARS).join("")
    const at = seen.indexOf(NEEDLE)
    return okAsync<CardInput[], CardsExtractError>(
      at === -1 ? [] : [card(NEEDLE, { spanStart: at, spanEnd: at + NEEDLE.length })],
    )
  }
  return { extract, calls }
}

const unit = Array.from({ length: EMBEDDING_DIMENSIONS }, (_v, i) => (i === 0 ? 1 : 0))
const embed = (texts: string[]) => okAsync(texts.map(() => unit))
const material = { id: "m-1", title: "Interview" }

describe("cardWindows", () => {
  it("covers every character, within the size, overlapping, starting at line starts", () => {
    const body = longText(1500, 1499)
    const windows = cardWindows(body, 14_000, 1000)
    expect(windows.length).toBeGreaterThan(4)
    expect(windows[0]?.start).toBe(0)
    expect(windows.at(-1)?.end).toBe(body.length)
    for (const [i, w] of windows.entries()) {
      expect(w.text.length).toBeLessThanOrEqual(14_000)
      expect(w.text).toBe(body.slice(w.start, w.end))
      if (i > 0) {
        const prev = windows[i - 1]
        expect(w.start, `window ${i} overlaps the previous one`).toBeLessThan(prev?.end ?? 0)
        expect(body[w.start - 1]).toBe("\n")
      }
    }
  })
})

describe("computeCardItems over the whole document", () => {
  it("a fact from the last part of a long document becomes a card", async () => {
    const body = longText(1500, 1495)
    expect(body.length).toBeGreaterThan(CARDS_MAX_BODY_CHARS * 4)
    const { extract, calls } = extractorSeeing()
    const out = await computeCardItems({ material, body, cardsEnabled: true, extract, embed })
    expect(out.ok).toBe(true)
    if (!out.ok) {
      throw new Error("expected ok")
    }
    expect(out.items.map((c) => c.body)).toEqual([NEEDLE])
    expect(calls.length).toBeGreaterThan(1)
    expect(out.coverage).toEqual({
      processedChars: body.length,
      totalChars: body.length,
      windows: calls.length,
      failedWindows: 0,
    })
    // The span points into the whole text, not into its window.
    const [c] = out.items
    expect(body.slice(c?.spanStart ?? 0, c?.spanEnd ?? 0)).toBe(NEEDLE)
  })

  it("a fact on the seam of two windows is one card", async () => {
    const body = longText(1500, 0)
    const windows = cardWindows(body)
    // Put the needle inside the overlap of windows 0 and 1.
    const seamLine = body.slice(0, windows[1]?.start ?? 0).split("\n").length + 2
    const seamed = longText(1500, seamLine)
    const { extract, calls } = extractorSeeing()
    const out = await computeCardItems({
      material,
      body: seamed,
      cardsEnabled: true,
      extract,
      embed,
    })
    if (!out.ok) {
      throw new Error("expected ok")
    }
    expect(calls.filter((c) => c.includes(NEEDLE)).length, "the needle sits in two windows").toBe(2)
    expect(out.items).toHaveLength(1)
  })

  it("a failed window fails the extraction, or — when partial is accepted — is counted", async () => {
    const body = longText(1500, 10)
    const failMiddle = (b: string) => !b.startsWith("Line 0:") && b.includes("Line 700:")
    const strict = await computeCardItems({
      material,
      body,
      cardsEnabled: true,
      extract: extractorSeeing(failMiddle).extract,
      embed,
    })
    expect(strict.ok).toBe(false)
    expect(strict.coverage?.failedWindows).toBeGreaterThan(0)
    const partial = await computeCardItems({
      material,
      body,
      cardsEnabled: true,
      extract: extractorSeeing(failMiddle).extract,
      embed,
      acceptPartial: true,
    })
    expect(partial.ok).toBe(true)
    if (!partial.ok) {
      throw new Error("expected ok")
    }
    expect(partial.items.map((c) => c.body)).toEqual([NEEDLE])
    expect(partial.coverage?.processedChars).toBeLessThan(body.length)
    expect(partial.coverage?.failedWindows).toBeGreaterThan(0)
  })
})

describe("structured outputs", () => {
  it("follow the profile unless set explicitly", () => {
    expect(structuredOutputsEnabled("strict")).toBe(true)
    expect(structuredOutputsEnabled("strict", "")).toBe(true)
    expect(structuredOutputsEnabled("standard")).toBe(false)
    expect(structuredOutputsEnabled("standard", "true")).toBe(true)
    expect(structuredOutputsEnabled("strict", "false")).toBe(false)
  })

  it("are on for the chat endpoint of a strict deployment", async () => {
    const bun = (globalThis as { Bun?: unknown }).Bun !== undefined ? process.execPath : "bun"
    const probe =
      'const { chatModel } = await import("@agenticmind/shared/lib/ai/chat"); console.log("structured=" + String(chatModel("gpt-4o-mini").supportsStructuredOutputs))'
    const child = spawn(bun, ["-e", probe], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: {
        ...process.env,
        SKIP_VALIDATION: "true",
        AGENTICMIND_PROFILE: "strict",
        CHAT_STRUCTURED_OUTPUTS: "",
      },
    })
    let output = ""
    const collect = (d: Buffer): void => {
      output += d.toString()
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    await once(child, "exit")
    expect(output).toContain("structured=true")
  }, 30_000)

  it("reach the chat endpoint the engine actually uses", () => {
    const model = chatModel("gpt-4o-mini") as unknown as { supportsStructuredOutputs?: boolean }
    expect(model.supportsStructuredOutputs).toBe(
      structuredOutputsEnabled(activeProfile(), aiSettings.CHAT_STRUCTURED_OUTPUTS),
    )
  })
})

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("a job that cannot read part of a text (real Postgres)", () => {
  const TENANT = randomUUID()
  const created: string[] = []
  let db: Database
  beforeAll(() => {
    db = createClient(DB_URL)
  })
  afterAll(async () => {
    for (const id of created) {
      await db.execute(sql`delete from materials where id = ${id}::uuid`)
    }
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  })

  it("retries, then keeps what it found and says which part is missing", async () => {
    const body = longText(1500, 10)
    const out = (
      await withTenant(db, TENANT, async (tx) =>
        ingestText({
          tx,
          blobStore: nopBlobStore,
          title: `b8-${randomUUID()}`,
          text: body,
          cardsEnabled: true,
          createdBy: randomUUID(),
          async: true,
        }),
      )
    )._unsafeUnwrap()
    created.push(out.materialId)
    const jobId = out.jobId ?? ""
    const { extract } = extractorSeeing((b) => !b.startsWith("Line 0:") && b.includes("Line 700:"))
    const runner = { db, workerId: `test-${randomUUID()}`, embed, extractCards: extract }
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await db.execute(
        sql`update ingestion_jobs set next_attempt_at = now() where id = ${jobId}::uuid`,
      )
      await runIngestionTick(runner, 50)
    }
    const job = (
      await db.execute(
        sql`select status, error_code, coverage from ingestion_jobs where id = ${jobId}::uuid`,
      )
    ).rows[0] as {
      status: string
      error_code: string | null
      coverage: { processedChars: number; totalChars: number; failedWindows: number }
    }
    expect(job.status).toBe("ready")
    expect(job.error_code).toBe("cards_partial")
    expect(job.coverage.failedWindows).toBeGreaterThan(0)
    expect(job.coverage.processedChars).toBeLessThan(job.coverage.totalChars)
    const cards = await db.execute(
      sql`select count(*)::int as n from knowledge_cards where material_id = ${out.materialId}::uuid`,
    )
    expect((cards.rows[0] as { n: number }).n).toBe(1)
  })
})

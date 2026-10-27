// oxlint-disable node/no-process-env -- UPDATE_CONTRACT_SNAPSHOT regenerates the frozen file
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import {
  klAskGlobalInput,
  klForgetInput,
  klIngestInput,
  klSearchInput,
} from "@agenticmind/shared/lib/knowledge/mcp-tools"
import {
  MAX_REVISION_SEGMENTS,
  klForgetSourceOutput,
  klGetIngestionStatusInput,
  klGetIngestionStatusOutput,
  klIngestOutputFields,
  klReadSourceInput,
  klReadSourceOutput,
  klSetSourceAvailabilityInput,
  klSetSourceAvailabilityOutput,
  klUpsertSourceInput,
  klUpsertSourceOutput,
  sourceRef,
} from "@agenticmind/shared/lib/knowledge/source-contract"
import { readFileSync, writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as z from "zod"

/**
 * Freezes the full JSON Schema — nested fields, bounds, enums — of every tool
 * that contract 1.11.0 adds or changes, inputs and outputs. mcp-contract.test.ts
 * freezes only top-level field names; this catches a changed nested field or
 * bound too. After an intended change, regenerate the file with
 * `UPDATE_CONTRACT_SNAPSHOT=1 bun test source-contract` and review its diff.
 */

const SNAPSHOT = new URL("__contract__/source-tools.schema.json", import.meta.url)

const SHAPES: Record<string, z.ZodType> = {
  "kl_upsert_source.input": klUpsertSourceInput,
  "kl_upsert_source.output": klUpsertSourceOutput,
  "kl_get_ingestion_status.input": klGetIngestionStatusInput,
  "kl_get_ingestion_status.output": klGetIngestionStatusOutput,
  "kl_read_source.input": klReadSourceInput,
  "kl_read_source.output": klReadSourceOutput,
  "kl_set_source_availability.input": klSetSourceAvailabilityInput,
  "kl_set_source_availability.output": klSetSourceAvailabilityOutput,
  "kl_search.input": klSearchInput,
  "kl_ask_global.input": klAskGlobalInput,
  "kl_ingest.input": klIngestInput,
  "kl_ingest.output.fields": klIngestOutputFields,
  "kl_forget.input": klForgetInput,
  "kl_forget.output.source": klForgetSourceOutput,
  "hit_and_citation.source_fields": sourceRef,
}

/** Drops what belongs to zod, not to the contract: the `$schema` URI and the
 * regex zod writes next to a named `format` (uuid, date-time) — a zod upgrade
 * may rewrite that regex while the contract stays the same. */
const normalize = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map((child) => normalize(child))
  }
  if (node === null || typeof node !== "object") {
    return node
  }
  const obj = node as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k]) => k !== "$schema" && !(k === "pattern" && "format" in obj))
      .map(([k, v]) => [k, normalize(v)]),
  )
}

const current = (): Record<string, unknown> =>
  Object.fromEntries(Object.entries(SHAPES).map(([k, s]) => [k, normalize(z.toJSONSchema(s))]))

describe("contract 1.11.0 shapes", () => {
  it("match the frozen JSON Schema file", () => {
    const actual = current()
    if (process.env.UPDATE_CONTRACT_SNAPSHOT === "1") {
      writeFileSync(SNAPSHOT, `${JSON.stringify(actual, null, 2)}\n`)
    }
    const frozen = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, unknown>
    expect(Object.keys(frozen).length, `keys: ${Object.keys(frozen).join(", ")}`).toBeGreaterThan(0)
    expect(actual).toEqual(frozen)
  })
})

const textRevision = {
  source: { sourceType: "meeting", externalId: "m-1" },
  revision: { text: "Agenda and notes." },
}

describe("kl_upsert_source input", () => {
  it("accepts a text revision and a dialogue revision", () => {
    expect(klUpsertSourceInput.safeParse(textRevision).success).toBe(true)
    const dialogue = {
      source: { sourceType: "meeting", externalId: "m-2", connectionId: "conn-a" },
      revision: {
        segments: [
          { speaker: "Interviewer", text: "What slowed you down?", startMs: 0, endMs: 2100 },
          { speaker: null, text: "Mostly the export step.", startMs: null },
        ],
        externalVersion: 3,
        occurredAt: "2026-10-01T09:00:00+02:00",
      },
      expectedRevisionId: null,
    }
    expect(klUpsertSourceInput.safeParse(dialogue).success).toBe(true)
  })

  it("bounds the number of segments", () => {
    const seg = { text: "x" }
    const at = (n: number) =>
      klUpsertSourceInput.safeParse({
        ...textRevision,
        revision: { segments: Array.from({ length: n }, () => seg) },
      }).success
    expect(at(MAX_REVISION_SEGMENTS)).toBe(true)
    expect(at(MAX_REVISION_SEGMENTS + 1)).toBe(false)
  })

  it("takes a lower-case source type only", () => {
    const withType = (sourceType: string) =>
      klUpsertSourceInput.safeParse({ ...textRevision, source: { sourceType, externalId: "a" } })
        .success
    expect(withType("repo_file")).toBe(true)
    expect(withType("Meeting")).toBe(false)
    expect(withType("")).toBe(false)
  })

  it("reserves restricted and personal visibility in the shape, and nothing else", () => {
    const withVisibility = (visibility: string) =>
      klUpsertSourceInput.safeParse({
        ...textRevision,
        source: { ...textRevision.source, visibility },
      }).success
    expect(withVisibility("workspace")).toBe(true)
    expect(withVisibility("restricted")).toBe(true)
    expect(withVisibility("personal")).toBe(true)
    expect(withVisibility("everyone")).toBe(false)
  })
})

describe("existing calls are unchanged", () => {
  // No new field has a default, so a pre-1.11 call parses to exactly what it sent.
  it.each([
    ["kl_search", klSearchInput, { q: "pricing", limit: 5 }],
    ["kl_ask_global", klAskGlobalInput, { question: "What changed?" }],
    ["kl_ingest", klIngestInput, { title: "Notes", text: "Body" }],
    ["kl_forget", klForgetInput, { id: "6f1c4a52-2d0e-4c55-9b7e-2a3c1d0e9f10" }],
  ] as const)("%s", (_tool, schema, args) => {
    expect((schema as z.ZodType).parse(args)).toEqual(args)
  })

  it("kl_forget can name a source by its external identity", () => {
    const args = { id: "m-1", sourceType: "meeting", connectionId: "conn-a", reason: "erasure" }
    expect(klForgetInput.parse(args)).toEqual(args)
  })
})

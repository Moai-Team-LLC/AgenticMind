// oxlint-disable typescript/no-explicit-any -- walks Zod's internal schema definition
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import {
  boundedJsonRecord,
  isSizeBoundedJson,
} from "@agenticmind/shared/lib/knowledge/bounded-json"
import { KNOWLEDGE_MCP_TOOLS } from "@agenticmind/shared/lib/knowledge/mcp-tools"
import { describe, expect, it } from "vitest"
import * as z from "zod"

/**
 * Input-bounds guard (GHSA-46jr-4wx8-v453, GHSA-mrhx-c7xc-m3w5): every array and
 * map in every MCP tool's input schema carries an explicit maximum, and
 * free-form JSON appears only inside a size-bounded field. The tools come from
 * the registry (KNOWLEDGE_MCP_TOOLS), not from a list in this file, so a new
 * tool or field is covered the moment it is added.
 */

type Survey = { arrays: string[]; maps: string[]; freeForm: string[]; problems: string[] }

const hasCheck = (schema: z.ZodType, kind: string): boolean =>
  ((schema as any)._zod.def.checks ?? []).some((c: any) => c._zod.def.check === kind)

const WRAPPERS = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "nonoptional",
  "readonly",
  "catch",
])

const walk = (schema: z.ZodType, path: string, s: Survey, inBoundedJson: boolean): void => {
  const def = (schema as any)._zod.def
  const bounded = inBoundedJson || isSizeBoundedJson(schema)
  const type: string = def.type
  if (WRAPPERS.has(type)) {
    walk(def.innerType, path, s, bounded)
    return
  }
  switch (type) {
    case "object": {
      for (const [key, child] of Object.entries(def.shape as Record<string, z.ZodType>)) {
        walk(child, `${path}.${key}`, s, bounded)
      }
      const catchall = def.catchall as z.ZodType | undefined
      if (catchall !== undefined && (catchall as any)._zod.def.type !== "never" && !bounded) {
        s.problems.push(`${path}: object accepts unknown keys without a bound`)
      }
      return
    }
    case "array": {
      s.arrays.push(path)
      if (!hasCheck(schema, "max_length")) {
        s.problems.push(`${path}: array without .max()`)
      }
      walk(def.element, `${path}[]`, s, bounded)
      return
    }
    case "record": {
      s.maps.push(path)
      if (typeof z.globalRegistry.get(schema)?.maxProperties !== "number") {
        s.problems.push(`${path}: record without a key-count bound (maxProperties)`)
      }
      walk(def.keyType, `${path}{key}`, s, bounded)
      walk(def.valueType, `${path}{}`, s, bounded)
      return
    }
    case "map":
    case "set": {
      s.maps.push(path)
      if (!hasCheck(schema, "max_size")) {
        s.problems.push(`${path}: ${type} without .max()`)
      }
      return
    }
    case "tuple": {
      for (const [i, item] of (def.items as z.ZodType[]).entries()) {
        walk(item, `${path}[${i}]`, s, bounded)
      }
      if (def.rest !== null && def.rest !== undefined) {
        s.problems.push(`${path}: tuple with an unbounded rest element`)
      }
      return
    }
    case "union": {
      for (const option of def.options as z.ZodType[]) {
        walk(option, path, s, bounded)
      }
      return
    }
    case "intersection": {
      walk(def.left, path, s, bounded)
      walk(def.right, path, s, bounded)
      return
    }
    case "pipe": {
      walk(def.in, path, s, bounded)
      walk(def.out, path, s, bounded)
      return
    }
    case "lazy": {
      s.problems.push(`${path}: recursive (lazy) schema — bound it explicitly`)
      return
    }
    case "unknown":
    case "any": {
      s.freeForm.push(path)
      if (!bounded) {
        s.problems.push(`${path}: free-form value outside a size-bounded field`)
      }
    }
  }
  // Anything else is a scalar (string, number, enum, literal, …), not a collection.
}

const survey = (schemas: { name: string; schema: z.ZodType }[]): Survey => {
  const s: Survey = { arrays: [], maps: [], freeForm: [], problems: [] }
  for (const { name, schema } of schemas) {
    walk(schema, name, s, false)
  }
  return s
}

const TOOLS = KNOWLEDGE_MCP_TOOLS.map((t) => {
  return { name: t.name, schema: t.inputSchema as z.ZodType }
})

describe("MCP tool input bounds", () => {
  it("every collection in every tool input schema is bounded", () => {
    const s = survey(TOOLS)
    // Control: the walk actually reached collections (prints what it found).
    expect(TOOLS.length, `tools: ${TOOLS.map((t) => t.name).join(", ")}`).toBeGreaterThan(0)
    expect(s.arrays.length, `arrays: ${s.arrays.join(", ")}`).toBeGreaterThan(0)
    expect(s.maps.length, `maps: ${s.maps.join(", ")}`).toBeGreaterThan(0)
    expect(s.problems).toEqual([])
  })

  it("the walk goes red on unbounded collections (self-check)", () => {
    const s = survey([
      {
        name: "fixture",
        schema: z.object({
          list: z.array(z.string()),
          map: z.record(z.string(), z.string()),
          blob: z.unknown(),
          loose: z.looseObject({ a: z.string() }),
        }),
      },
    ])
    expect(s.problems).toEqual([
      "fixture.list: array without .max()",
      "fixture.map: record without a key-count bound (maxProperties)",
      "fixture.blob: free-form value outside a size-bounded field",
      "fixture.loose: object accepts unknown keys without a bound",
    ])
  })

  it("every bounded record enforces its key bound", () => {
    const records: { path: string; schema: z.ZodType }[] = []
    const collect = (schema: z.ZodType, path: string): void => {
      const def = (schema as any)._zod.def
      if (WRAPPERS.has(def.type)) {
        collect(def.innerType, path)
      } else if (def.type === "object") {
        for (const [k, child] of Object.entries(def.shape as Record<string, z.ZodType>)) {
          collect(child, `${path}.${k}`)
        }
      } else if (def.type === "record") {
        records.push({ path, schema })
      }
    }
    for (const t of TOOLS) {
      collect(t.schema, t.name)
    }
    expect(records.length, `records: ${records.map((r) => r.path).join(", ")}`).toBeGreaterThan(0)
    for (const r of records) {
      const max = z.globalRegistry.get(r.schema)?.maxProperties as number
      const over = Object.fromEntries(Array.from({ length: max + 1 }, (_, i) => [`k${i}`, null]))
      const atMax = Object.fromEntries(Array.from({ length: max }, (_, i) => [`k${i}`, null]))
      expect(r.schema.safeParse(over).success, `${r.path} with ${max + 1} keys`).toBe(false)
      expect(r.schema.safeParse(atMax).success, `${r.path} with ${max} keys`).toBe(true)
    }
  })
})

describe("boundedJsonRecord", () => {
  const ctx = boundedJsonRecord({ maxKeys: 3, maxKeyLength: 8, maxJsonBytes: 64 })

  it("accepts nested JSON within the caps", () => {
    expect(ctx.safeParse({ a: [1, 2], b: { c: "d" } }).success).toBe(true)
  })

  it("rejects too many keys, a long key, or too many bytes", () => {
    expect(ctx.safeParse({ a: 1, b: 2, c: 3, d: 4 }).success).toBe(false)
    expect(ctx.safeParse({ "key-too-long": 1 }).success).toBe(false)
    expect(ctx.safeParse({ a: "x".repeat(100) }).success).toBe(false)
  })

  it("exposes the key bound to clients as maxProperties", () => {
    const json = z.toJSONSchema(z.object({ c: ctx })) as unknown as {
      properties: { c: { maxProperties?: number } }
    }
    expect(json.properties.c.maxProperties).toBe(3)
  })
})

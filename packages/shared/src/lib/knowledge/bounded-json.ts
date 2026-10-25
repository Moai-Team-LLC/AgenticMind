/**
 * Bounded free-form JSON for MCP tool inputs.
 *
 * Every array and map in a tool's input schema carries an explicit maximum, so
 * the size of what is validated is set by the schema, not by the caller. A
 * free-form JSON field (`z.unknown()` values) cannot carry a per-collection
 * bound — the nested arrays and objects are arbitrary — so it is bounded as a
 * whole: a cap on its top-level keys (exposed to clients as `maxProperties`) and
 * on its serialized size.
 *
 * Schemas built here are registered, so the input-bounds test can tell a
 * size-bounded free-form field from an unbounded `z.unknown()`.
 */

import * as z from "zod"

const SIZE_BOUNDED = new WeakSet<z.ZodType>()

/** True when `schema` was built by `boundedJsonRecord` (its JSON size is capped). */
export const isSizeBoundedJson = (schema: z.ZodType): boolean => SIZE_BOUNDED.has(schema)

const jsonBytes = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** A string-keyed record of arbitrary JSON values with key-count and byte caps. */
export const boundedJsonRecord = (limits: {
  maxKeys: number
  maxKeyLength: number
  maxJsonBytes: number
}) => {
  const schema = z
    .record(z.string().max(limits.maxKeyLength), z.unknown())
    .refine((value) => Object.keys(value).length <= limits.maxKeys, {
      message: `at most ${limits.maxKeys} keys`,
    })
    .refine((value) => jsonBytes(value) <= limits.maxJsonBytes, {
      message: `at most ${limits.maxJsonBytes} bytes of JSON`,
    })
    .meta({ maxProperties: limits.maxKeys })
  SIZE_BOUNDED.add(schema)
  return schema
}

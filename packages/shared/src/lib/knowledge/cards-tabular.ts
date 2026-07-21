/**
 * Deterministic tabular card extractor. An operator pins a
 * column→ontology mapping on a CSV/xlsx material; each data row emits a qa
 * summary card + one fact card per mapped predicate. No LLM, no variance,
 * fully auditable.
 */

import type { CardInput } from "@agenticmind/shared/database/query/knowledge/cards"
import type { Table } from "@agenticmind/shared/lib/knowledge/extract-tabular"
import type { Result } from "neverthrow"

import { isValidPredicate, isValidSubjectType } from "@agenticmind/shared/lib/knowledge/ontology"
import { err, ok } from "neverthrow"

const TABULAR_EXTRACTOR_VERSION = "tabular-v1"

export type TabularPredicateMap = {
  column: string
  predicate: string
  objectType: string
}

export type TabularSchema = {
  subjectType: string
  subjectColumn: string
  predicates: TabularPredicateMap[]
  skipColumns: string[]
  /** Confidence stamped on every emitted card (operator-curated → high). */
  minConfidence: number
}

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/**
 * Decodes + validates a tabular schema from the JSONB blob in
 * materials.metadata.tabular_schema. Returns the first unfit field as an error
 * — no partial schemas.
 */
export const parseTabularSchema = (raw: unknown): Result<TabularSchema, string> => {
  if (raw === null || raw === undefined) {
    return err("cards: no tabular schema on material")
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return err("tabular schema: expected object")
  }
  const mp = raw as Record<string, unknown>

  const subjectType = asString(mp.subjectType)
  if (subjectType === "") {
    return err("tabular schema: subjectType is required")
  }
  if (!isValidSubjectType(subjectType)) {
    return err(`tabular schema: subjectType "${subjectType}" not in ontology V0`)
  }
  const subjectColumn = asString(mp.subjectColumn)
  if (subjectColumn === "") {
    return err("tabular schema: subjectColumn is required")
  }

  const predicates: TabularPredicateMap[] = []
  if (Array.isArray(mp.predicates)) {
    for (let i = 0; i < mp.predicates.length; i++) {
      // `Array.isArray` narrows an `unknown` to `any[]` (a TS quirk), so pin the
      // element back to `unknown` — the guards below re-narrow it explicitly.
      const pRaw: unknown = mp.predicates[i]
      if (typeof pRaw !== "object" || pRaw === null) {
        return err(`tabular schema: predicates[${i}] is not an object`)
      }
      const pMap = pRaw as Record<string, unknown>
      const column = asString(pMap.column)
      const predicate = asString(pMap.predicate)
      const objectType = asString(pMap.objectType)
      if (column === "" || predicate === "") {
        return err(`tabular schema: predicates[${i}] requires column + predicate`)
      }
      if (!isValidPredicate(predicate)) {
        return err(`tabular schema: predicates[${i}].predicate "${predicate}" not in ontology V0`)
      }
      if (objectType !== "" && !isValidSubjectType(objectType)) {
        return err(`tabular schema: predicates[${i}].objectType "${objectType}" not in ontology V0`)
      }
      predicates.push({ column, predicate, objectType })
    }
  }

  const skipColumns: string[] = []
  if (Array.isArray(mp.skipColumns)) {
    for (const s of mp.skipColumns) {
      if (typeof s === "string") {
        skipColumns.push(s.trim())
      }
    }
  }

  let minConfidence = typeof mp.minConfidence === "number" ? mp.minConfidence : 0
  if (minConfidence <= 0) {
    minConfidence = 0.95
  }
  if (minConfidence > 1) {
    minConfidence = 1
  }

  return ok({ subjectType, subjectColumn, predicates, skipColumns, minConfidence })
}

const buildColumnIndex = (headers: string[]): Map<string, number> => {
  const out = new Map<string, number>()
  for (const [i, h] of headers.entries()) {
    out.set(h.trim().toLowerCase(), i)
  }
  return out
}

const buildRowSummary = (
  table: Table,
  row: string[],
  subjectColumn: string,
  skipCols: Set<string>,
): string => {
  const subjectColLower = subjectColumn.toLowerCase()
  const parts: string[] = []
  let subject = ""
  for (let i = 0; i < table.headers.length && i < row.length; i++) {
    const key = table.headers[i]?.trim().toLowerCase() ?? ""
    const val = row[i]?.trim() ?? ""
    if (val === "") {
      continue
    }
    if (key === subjectColLower) {
      subject = val
      continue
    }
    if (skipCols.has(key)) {
      continue
    }
    parts.push(`${table.headers[i]}: ${val}`)
  }
  if (subject === "") {
    return ""
  }
  if (parts.length === 0) {
    return subject
  }
  return `${subject} — ${parts.join(", ")}.`
}

/**
 * Emits cards from table rows using the schema. One qa summary card per row +
 * one fact card per non-empty mapped predicate. Skips rows with an empty
 * subject value. Embeddings are added by the caller before upsert.
 */
export const extractFromTables = (tables: Table[], schema: TabularSchema): CardInput[] => {
  if (tables.length === 0) {
    return []
  }
  const skipCols = new Set(schema.skipColumns.map((c) => c.toLowerCase()))
  const out: CardInput[] = []

  for (const table of tables) {
    const colIdx = buildColumnIndex(table.headers)
    const subjectIdx = colIdx.get(schema.subjectColumn.toLowerCase())
    if (subjectIdx === undefined) {
      continue
    } // Sheet lacks the subject column

    const resolved = schema.predicates.map((pred) => {
      return {
        pred,
        col: colIdx.get(pred.column.toLowerCase()),
      }
    })

    for (const row of table.rows) {
      const subjectValue = subjectIdx < row.length ? (row[subjectIdx]?.trim() ?? "") : ""
      if (subjectValue === "") {
        continue
      }

      const summary = buildRowSummary(table, row, schema.subjectColumn, skipCols)
      if (summary !== "") {
        out.push({
          kind: "qa",
          subjectType: schema.subjectType,
          subjectValue,
          question: `What is ${subjectValue}?`,
          body: summary,
          confidence: schema.minConfidence,
          extractorVersion: TABULAR_EXTRACTOR_VERSION,
        })
      }

      for (const { pred, col } of resolved) {
        if (col === undefined || col >= row.length) {
          continue
        }
        const value = row[col]?.trim() ?? ""
        if (value === "") {
          continue
        }
        out.push({
          kind: "fact",
          subjectType: schema.subjectType,
          subjectValue,
          predicate: pred.predicate,
          value,
          body: `${subjectValue} ${pred.predicate} ${value}`,
          confidence: schema.minConfidence,
          extractorVersion: TABULAR_EXTRACTOR_VERSION,
        })
      }
    }
  }
  return out
}

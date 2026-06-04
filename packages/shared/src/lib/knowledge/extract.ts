/**
 * Bytes → plain text for the RAG pipeline. Classifies a MIME type and
 * dispatches: text/json/yaml pass through; HTML is cleaned (extract-html);
 * CSV/TSV/xlsx go through the structured tabular parser (Tables +
 * row-as-paragraph text); PDF via unpdf; DOCX via mammoth. Unknown MIMEs
 * return an "unsupported" error so the upload handler can leave the material
 * at status=ingesting.
 */

import type { Table } from "@agenticmind/shared/lib/knowledge/extract-tabular"

import { extractHtml } from "@agenticmind/shared/lib/knowledge/extract-html"
import {
  extractDelimited,
  renderTablesAsParagraphs,
  tableFromRows,
} from "@agenticmind/shared/lib/knowledge/extract-tabular"
import { errAsync, okAsync, ResultAsync } from "neverthrow"

export type MimeKind = "unknown" | "text" | "html" | "pdf" | "docx" | "csv" | "tsv" | "xlsx"

export type ExtractResult = {
  text: string
  kind: MimeKind
  bytes: number
  /** ≥1 for PDFs, 0 otherwise. */
  pages: number
  /** Non-empty only for csv/tsv/xlsx. */
  tables: Table[]
}

export type ExtractError = {
  readonly type: "extract_error"
  readonly code: "unsupported" | "empty" | "parse"
  readonly message: string
}

const extractError = (code: ExtractError["code"], message: string): ExtractError => {
  return {
    type: "extract_error",
    code,
    message,
  }
}

/** Maps a Content-Type onto a coarse MimeKind. Case-insensitive, ignores params. */
export const classify = (mime: string): MimeKind => {
  let m = mime.toLowerCase().trim()
  const semi = m.indexOf(";")
  if (semi !== -1) {
    m = m.slice(0, semi).trim()
  }

  if (m === "text/html" || m === "application/xhtml+xml") {
    return "html"
  }
  if (m === "text/csv" || m === "application/csv") {
    return "csv"
  }
  if (m === "text/tab-separated-values" || m === "text/tsv") {
    return "tsv"
  }
  if (
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    m === "application/vnd.ms-excel"
  ) {
    return "xlsx"
  }
  if (m.startsWith("text/")) {
    return "text"
  }
  if (
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/yaml" ||
    m === "application/x-yaml"
  ) {
    return "text"
  }
  if (m === "application/pdf") {
    return "pdf"
  }
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx"
  }
  return "unknown"
}

export const canExtract = (mime: string): boolean => classify(mime) !== "unknown"

const decode = (body: Uint8Array): string => new TextDecoder("utf-8").decode(body)

const extractTabular = (
  body: Uint8Array,
  kind: "csv" | "tsv",
): ResultAsync<ExtractResult, ExtractError> => {
  try {
    const table = extractDelimited(decode(body), kind === "csv" ? "," : "\t")
    return okAsync({
      text: renderTablesAsParagraphs([table]),
      kind,
      bytes: body.byteLength,
      pages: 0,
      tables: [table],
    })
  } catch (error) {
    return errAsync(
      extractError("empty", error instanceof Error ? error.message : "tabular parse failed"),
    )
  }
}

const extractPdf = (body: Uint8Array): ResultAsync<ExtractResult, ExtractError> =>
  ResultAsync.fromPromise(
    (async (): Promise<ExtractResult> => {
      const { extractText, getDocumentProxy } = await import("unpdf")
      const pdf = await getDocumentProxy(body)
      const { totalPages, text } = await extractText(pdf, { mergePages: true })
      return { text, kind: "pdf", bytes: body.byteLength, pages: totalPages, tables: [] }
    })(),
    (e) => extractError("parse", `pdf: ${e instanceof Error ? e.message : "parse failed"}`),
  )

const extractDocx = (body: Uint8Array): ResultAsync<ExtractResult, ExtractError> =>
  ResultAsync.fromPromise(
    (async (): Promise<ExtractResult> => {
      const mammoth = await import("mammoth")
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(body) })
      return { text: value.trim(), kind: "docx", bytes: body.byteLength, pages: 0, tables: [] }
    })(),
    (e) => extractError("parse", `docx: ${e instanceof Error ? e.message : "parse failed"}`),
  )

const extractXlsx = (body: Uint8Array): ResultAsync<ExtractResult, ExtractError> =>
  ResultAsync.fromPromise(
    (async (): Promise<ExtractResult> => {
      const XLSX = await import("xlsx")
      const wb = XLSX.read(body, { type: "array" })
      const tables: Table[] = []
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name]
        if (sheet === undefined) {
          continue
        }
        const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: false,
          defval: "",
        })
        const rows = raw.map((r) =>
          r.map((c) => {
            if (typeof c === "string") {
              return c
            }
            if (typeof c === "number" || typeof c === "boolean") {
              return String(c)
            }
            return ""
          }),
        )
        if (rows.length === 0) {
          continue
        }
        const table = tableFromRows(name, rows)
        if (table.rows.length > 0) {
          tables.push(table)
        }
      }
      if (tables.length === 0) {
        throw new Error("all sheets empty")
      }
      return {
        text: renderTablesAsParagraphs(tables),
        kind: "xlsx",
        bytes: body.byteLength,
        pages: 0,
        tables,
      }
    })(),
    (e) => extractError("parse", `xlsx: ${e instanceof Error ? e.message : "parse failed"}`),
  )

/** Extracts plain text + structured tables from a body of the given MIME. */
export const extract = (
  mime: string,
  body: Uint8Array,
): ResultAsync<ExtractResult, ExtractError> => {
  if (body.byteLength === 0) {
    return errAsync(extractError("empty", "extract: empty body"))
  }
  const kind = classify(mime)
  switch (kind) {
    case "text": {
      return okAsync({ text: decode(body), kind, bytes: body.byteLength, pages: 0, tables: [] })
    }
    case "html": {
      return okAsync({
        text: extractHtml(decode(body)),
        kind,
        bytes: body.byteLength,
        pages: 0,
        tables: [],
      })
    }
    case "csv": {
      return extractTabular(body, "csv")
    }
    case "tsv": {
      return extractTabular(body, "tsv")
    }
    case "pdf": {
      return extractPdf(body)
    }
    case "docx": {
      return extractDocx(body)
    }
    case "xlsx": {
      return extractXlsx(body)
    }
    case "unknown": {
      break
    }
  }
  return errAsync(extractError("unsupported", `extract: unsupported MIME ${mime}`))
}

export type { Table } from "@agenticmind/shared/lib/knowledge/extract-tabular"

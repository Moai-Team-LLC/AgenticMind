/**
 * Tabular extraction (CSV/TSV/xlsx shared helpers) — ported from
 * services/knowledge/internal/extract/tabular.go. Parses delimited text into a
 * Table (header auto-detect + ragged-row padding) and flattens tables into the
 * chunker-friendly "row-as-paragraph" text so each row lands in its own chunk.
 */

/** One parsed tabular sheet. Headers is never empty; Rows excludes the header. */
export type Table = {
  /** Worksheet name for xlsx; "" for single-sheet CSV/TSV. */
  name: string
  /** Column names, never empty (synthesised col_N when no header row). */
  headers: string[]
  /** Each row's cells in column order, padded/truncated to headers.length. */
  rows: string[][]
}

/** Cap on cells parsed from one source — defends against runaway memory. */
export const MAX_TABULAR_CELLS = 10_000_000
/** Cap on rows flattened into the chunkable text (Tables keeps the rest). */
export const MAX_ROWS_RENDERED = 5_000

/** True when the string is exactly an int/decimal (optional sign). */
export const isPurelyNumeric = (input: string): boolean => {
  let s = input.trim()
  if (s === "") return false
  if (s[0] === "+" || s[0] === "-") {
    s = s.slice(1)
    if (s === "") return false
  }
  let dotSeen = false
  for (const r of s) {
    if (r === ".") {
      if (dotSeen) return false
      dotSeen = true
      continue
    }
    if (r < "0" || r > "9") return false
  }
  return true
}

/** Row 0 is a header when every cell is non-empty, non-numeric, ≤200 chars. */
export const isLikelyHeader = (row: string[]): boolean => {
  if (row.length === 0) return false
  for (const cell of row) {
    const c = cell.trim()
    if (c === "" || isPurelyNumeric(c) || c.length > 200) return false
  }
  return true
}

const splitHeaderAndRows = (rows: string[][]): { headers: string[]; data: string[][] } => {
  if (rows.length === 0) return { headers: [], data: [] }
  const first = rows[0]!
  if (isLikelyHeader(first)) {
    const headers = first.map((h, i) => {
      const trimmed = h.trim()
      return trimmed === "" ? `col_${i + 1}` : trimmed
    })
    return { headers, data: rows.slice(1) }
  }
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0)
  const headers = Array.from({ length: width }, (_, i) => `col_${i + 1}`)
  return { headers, data: rows }
}

const padRows = (data: string[][], width: number): string[][] =>
  data.map((r) => {
    if (r.length < width) return [...r, ...Array.from({ length: width - r.length }, () => "")]
    if (r.length > width) return r.slice(0, width)
    return r
  })

/**
 * RFC4180-ish delimited parser: handles quoted fields with embedded delimiters/
 * newlines and "" escapes, tolerant of lazy quotes, trims leading field space,
 * normalises CRLF. Mirrors the Go encoding/csv config used by extractCSV.
 */
export const parseDelimited = (text: string, delim: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  let fieldStart = true

  const endField = () => {
    row.push(field)
    field = ""
    fieldStart = true
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && field === "") {
      inQuotes = true
      fieldStart = false
      continue
    }
    if (ch === delim) {
      endField()
      continue
    }
    if (ch === "\n") {
      endRow()
      continue
    }
    if (ch === "\r") continue
    if (fieldStart && ch === " ") continue
    field += ch
    fieldStart = false
  }
  // Trailing field/row when the input doesn't end on a newline.
  if (field !== "" || row.length > 0) {
    rows.push([...row, field])
  }
  return rows
}

/** Builds a Table from already-parsed rows (header detect + ragged padding). */
export const tableFromRows = (name: string, rows: string[][]): Table => {
  const { headers, data } = splitHeaderAndRows(rows)
  return { name, headers, rows: padRows(data, headers.length) }
}

/** Parses delimited bytes/text into a single Table. Throws on empty input. */
export const extractDelimited = (body: string, delim: string): Table => {
  if (body.length === 0) throw new Error("extract: empty body")
  const rows = parseDelimited(body, delim)
  if (rows.length === 0) throw new Error("extract: tabular source has no rows")
  return tableFromRows("", rows)
}

export { splitHeaderAndRows, padRows }

/**
 * Flattens tables into "row-as-paragraph" text. Each row is a paragraph keyed
 * by header columns, separated by blank lines so the chunker emits one chunk
 * per row. Sheet name prefixes rows only on multi-sheet (xlsx) input. Empty
 * cells are skipped; rendering stops at MAX_ROWS_RENDERED.
 */
export const renderTablesAsParagraphs = (tables: Table[]): string => {
  const parts: string[] = []
  let rendered = 0
  for (const t of tables) {
    if (t.rows.length === 0) continue
    const multiSheet = tables.some((other) => other.name !== t.name && other.name !== "")
    for (let i = 0; i < t.rows.length; i++) {
      if (rendered >= MAX_ROWS_RENDERED) {
        parts.push(`\n[…rows truncated; ${MAX_ROWS_RENDERED}-row chunkable cap reached]\n`)
        return parts.join("").trim()
      }
      const row = t.rows[i]!
      const lines: string[] = []
      lines.push(
        multiSheet && t.name !== "" ? `[Sheet "${t.name}" — row ${i + 1}]` : `[row ${i + 1}]`,
      )
      for (let col = 0; col < row.length && col < t.headers.length; col++) {
        const v = row[col]!.trim()
        if (v === "") continue
        lines.push(`${t.headers[col]}: ${v}`)
      }
      parts.push(lines.join("\n"))
      rendered++
    }
  }
  return parts.join("\n\n").trim()
}

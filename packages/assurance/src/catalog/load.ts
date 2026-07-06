import { err, ok, type Result } from "neverthrow"
/**
 * Control Catalog loader (FR-7.2/7.3).
 *
 * Loads + validates the catalog YAML into a queryable in-memory model. Fail-closed: an unknown
 * ASI id or a missing required field returns a typed error, never a partial catalog.
 */
import { readFileSync } from "node:fs"
import { parse as parseYaml } from "yaml"

import { Catalog } from "./schema"

export type CatalogError =
  | { kind: "read"; path: string; message: string }
  | { kind: "parse"; path: string; message: string }
  | { kind: "validation"; path: string; message: string; issues: readonly CatalogIssue[] }

export interface CatalogIssue {
  path: string
  message: string
}

/** Validate an already-in-memory catalog value. */
export function parseCatalog(raw: unknown, path = "<memory>"): Result<Catalog, CatalogError> {
  const parsed = Catalog.safeParse(raw)
  if (!parsed.success) {
    return err({
      kind: "validation",
      path,
      message: `catalog failed validation (${parsed.error.issues.length} issue(s))`,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    })
  }
  return ok(parsed.data)
}

/** Load, parse, and validate the catalog YAML file. */
export function loadCatalog(path: string): Result<Catalog, CatalogError> {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (cause) {
    return err({ kind: "read", path, message: messageOf(cause) })
  }
  let data: unknown
  try {
    data = parseYaml(text)
  } catch (cause) {
    return err({ kind: "parse", path, message: messageOf(cause) })
  }
  return parseCatalog(data, path)
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

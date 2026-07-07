import type { Result } from "neverthrow"

import { err, ok } from "neverthrow"
/**
 * Control Catalog loader (FR-7.2/7.3).
 *
 * Loads + validates the catalog YAML into a queryable in-memory model. Fail-closed: an unknown
 * ASI id or a missing required field returns a typed error, never a partial catalog.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"

import { Catalog } from "./schema"

export type CatalogError =
  | { kind: "read"; path: string; message: string }
  | { kind: "parse"; path: string; message: string }
  | { kind: "validation"; path: string; message: string; issues: readonly CatalogIssue[] }

export type CatalogIssue = {
  path: string
  message: string
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/** Validate an already-in-memory catalog value. */
export const parseCatalog = (raw: unknown, path = "<memory>"): Result<Catalog, CatalogError> => {
  const parsed = Catalog.safeParse(raw)
  if (!parsed.success) {
    return err({
      kind: "validation",
      path,
      message: `catalog failed validation (${parsed.error.issues.length} issue(s))`,
      issues: parsed.error.issues.map((i) => {
        return { path: i.path.join("."), message: i.message }
      }),
    })
  }
  return ok(parsed.data)
}

/** Load, parse, and validate the catalog YAML file. */
export const loadCatalog = (path: string): Result<Catalog, CatalogError> => {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    return err({ kind: "read", path, message: messageOf(error) })
  }
  let data: unknown
  try {
    data = parseYaml(text)
  } catch (error) {
    return err({ kind: "parse", path, message: messageOf(error) })
  }
  return parseCatalog(data, path)
}

/** Load the catalog YAML bundled with this package — for consumers (e.g. the worker) that should
 *  not have to know its on-disk path. Resolved relative to this module. */
export const loadBundledCatalog = (): Result<Catalog, CatalogError> =>
  loadCatalog(fileURLToPath(new URL("../../catalog/aal-control-catalog.yaml", import.meta.url)))

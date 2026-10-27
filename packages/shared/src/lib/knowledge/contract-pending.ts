/**
 * Contract items declared ahead of the code that serves them. Contract 1.11.0
 * is frozen first and implemented change by change; until a tool or field is
 * implemented, the server does not list the tool and refuses a call that sets
 * the field — it never accepts a field only to ignore it.
 *
 * Each implementation change removes its entries. contract-pending.test.ts
 * fails once the package version reaches PENDING_RELEASE while anything is
 * still listed, so the release cannot ship a contract the server only pretends
 * to serve.
 */

/** The release these items are promised for. */
export const PENDING_RELEASE = "0.15.0"

/** Tools in the contract that the server does not register yet. */
export const PENDING_TOOLS: readonly string[] = [
  "kl_upsert_source",
  "kl_get_ingestion_status",
  "kl_read_source",
  "kl_set_source_availability",
]

/** Optional input fields of served tools that the server does not honour yet. */
export const PENDING_FIELDS: Readonly<Record<string, readonly string[]>> = {
  kl_search: ["mode", "sourceTypes", "period"],
  kl_ask_global: ["mode", "sourceTypes", "period"],
  kl_ingest: ["source", "async"],
  kl_forget: ["sourceType", "connectionId", "reason"],
}

/** The pending fields a call actually sets (present and not undefined). */
export const pendingFieldsIn = (tool: string, args: Record<string, unknown>): string[] =>
  (PENDING_FIELDS[tool] ?? []).filter((field) => args[field] !== undefined)

/** The refusal a call with pending fields gets. */
export const pendingFieldsMessage = (tool: string, fields: readonly string[]): string =>
  `${tool}: ${fields.map((f) => `'${f}'`).join(", ")} ${
    fields.length === 1 ? "is" : "are"
  } in contract 1.11.0 but not supported by this server yet`

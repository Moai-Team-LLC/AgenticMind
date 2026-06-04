/**
 * Material domain enums — source + status vocabularies. Backed by CHECK
 * constraints on the `materials` table; kept as unions (not pgEnum) so adding a
 * value is a code change, not an ALTER TYPE.
 *
 * `source` records how a material entered the corpus. The substrate is
 * MCP-native — agents and operators feed it directly via `kl_ingest` / the CLI —
 * so there is one value, `manual`. (The old crawl-connector origins
 * http_url/google_drive/notion/telegram were dropped with the connectors.)
 */

export const MATERIAL_SOURCES = ["manual"] as const
export type MaterialSource = (typeof MATERIAL_SOURCES)[number]

export const MATERIAL_STATUSES = [
  "ingesting",
  "chunking",
  "embedding",
  "embedded",
  "failed",
] as const
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number]

export const isMaterialSource = (value: string): value is MaterialSource =>
  (MATERIAL_SOURCES as readonly string[]).includes(value)

export const isMaterialStatus = (value: string): value is MaterialStatus =>
  (MATERIAL_STATUSES as readonly string[]).includes(value)

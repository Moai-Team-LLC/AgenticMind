// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import { SYNC_INGEST_BUDGET_MS } from "@agenticmind/shared/lib/knowledge/ingest"
import { describe, expect, it } from "vitest"

import { MCP_MAX_DURATION_SECONDS } from "./mcp-limits"

/**
 * A synchronous kl_ingest must answer before mcp-handler ends the request —
 * otherwise the caller gets an empty response for a material that was in fact
 * stored, retries, and duplicates it. The budget leaves room for the writes
 * and the job hand-off that follow the last model step.
 */
const MARGIN_MS = 15_000

describe("synchronous ingest budget", () => {
  it("ends well before the MCP request cap", () => {
    expect(SYNC_INGEST_BUDGET_MS).toBeGreaterThan(0)
    expect(SYNC_INGEST_BUDGET_MS + MARGIN_MS).toBeLessThanOrEqual(MCP_MAX_DURATION_SECONDS * 1000)
  })
})

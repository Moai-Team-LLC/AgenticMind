/**
 * MCP streamable-HTTP handler — exposes the knowledge layer to external MCP
 * clients (Claude Desktop, Cursor, agents). Framework-agnostic: `mcp-handler`
 * produces a fetch handler `(Request) => Promise<Response>`, hosted by Bun in
 * index.ts. No Next.js — this is a headless service.
 *
 * Auth (withMcpAuth → verifyMcpAccess): the bearer must be a valid typ="mcp"
 * JWT (HS256 / AUTH_SECRET) whose jti is active in mcp_tokens. Fails CLOSED.
 * Per-token scopes drive least-privilege: read tools need knowledge:read
 * (endpoint-level), kl_signal needs knowledge:signal (enforced in the tool).
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { z } from "zod"

import { checkMcpToken } from "@agenticmind/shared/database/query/knowledge/mcp-tokens"
import {
  klAskGlobal,
  klAskGlobalInput,
  klGetMaterial,
  klGetMaterialInput,
  klGraphNeighbors,
  klGraphNeighborsInput,
  klSearch,
  klSearchInput,
  klSignal,
  klSignalInput,
  memRecall,
  memRecallInput,
  memWrite,
  memWriteInput,
  klIngest,
  klIngestInput,
  type McpToolDeps,
} from "@agenticmind/shared/lib/knowledge/mcp-tools"
import { createMcpHandler, withMcpAuth } from "mcp-handler"

import { getDb } from "@/server/lib/database"
import {
  getKnowledgeBlobStore,
  getKnowledgeGraphRepo,
  knowledgeFeatureFlags,
} from "@/server/lib/knowledge-deps"
import { verifyMcpToken } from "@/server/lib/mcp-jwt"

type ToolResult = {
  content: { type: "text"; text: string }[]
  isError?: boolean
}

const jsonContent = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
})

const errorContent = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
})

type ToolExtra = { authInfo?: { scopes?: string[]; clientId?: string } }

const toolDeps = (extra?: ToolExtra): McpToolDeps => {
  const flags = knowledgeFeatureFlags()
  return {
    tx: getDb(),
    cardsEnabled: flags.cardsEnabled,
    cacheEnabled: flags.cacheEnabled,
    graph: flags.graphragEnabled ? getKnowledgeGraphRepo() : undefined,
    scopes: extra?.authInfo?.scopes,
    actorUuid: extra?.authInfo?.clientId ?? null,
    blobStore: getKnowledgeBlobStore(),
  }
}

/**
 * Registers one knowledge tool. The two `as never` casts bridge a purely
 * type-level mismatch between the app's zod v4 and the SDK's own zod identity;
 * we `safeParse` inside so the handler always receives validated args.
 */
const registerKlTool = <S extends z.ZodType>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  schema: S,
  handle: (args: z.infer<S>, extra: ToolExtra) => Promise<ToolResult>,
): void => {
  server.registerTool(name, { title, description, inputSchema: schema as never }, (async (
    raw: unknown,
    extra: ToolExtra,
  ): Promise<ToolResult> => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return errorContent(`${name}: invalid arguments`)
    return handle(parsed.data as z.infer<S>, extra)
  }) as never)
}

const handler = createMcpHandler(
  (server) => {
    registerKlTool(
      server,
      "kl_search",
      "Search knowledge base",
      "Search the knowledge base by semantic similarity. Returns the top-K passages with material titles and scores.",
      klSearchInput,
      async (args, extra) => {
        try {
          return jsonContent(await klSearch(toolDeps(extra), args))
        } catch (e) {
          return errorContent(e instanceof Error ? e.message : "kl_search failed")
        }
      },
    )

    registerKlTool(
      server,
      "kl_ask_global",
      "Ask the knowledge base",
      "Ask a natural-language question. Retrieves relevant passages, synthesises an answer, and returns citation markers keyed to source materials. Optional intent/facts tailor the answer to the calling agent's goal.",
      klAskGlobalInput,
      async (args, extra) => {
        try {
          return jsonContent(await klAskGlobal(toolDeps(extra), args))
        } catch (e) {
          return errorContent(e instanceof Error ? e.message : "kl_ask_global failed")
        }
      },
    )

    registerKlTool(
      server,
      "kl_get_material",
      "Get material",
      "Fetch metadata for a single material by its UUID.",
      klGetMaterialInput,
      async (args, extra) => {
        try {
          return jsonContent(await klGetMaterial(toolDeps(extra), args))
        } catch (e) {
          return errorContent(e instanceof Error ? e.message : "kl_get_material failed")
        }
      },
    )

    registerKlTool(
      server,
      "kl_signal",
      "Emit feedback signal",
      "Emit a programmatic feedback signal (verified_supported, eval_passed, downstream_failure, …) on a prior answer by its askId. Drives the self-improving compounding loop without a human. Requires the knowledge:signal scope.",
      klSignalInput,
      async (args, extra) => {
        try {
          return jsonContent(await klSignal(toolDeps(extra), args))
        } catch (e) {
          return errorContent(e instanceof Error ? e.message : "kl_signal failed")
        }
      },
    )

    registerKlTool(
      server,
      "mem_recall",
      "Recall memory",
      "Recall your beliefs (your private memory ∪ shared memory). Filter by subject or semantic query; pass asOf (ISO time) to time-travel to what was believed then.",
      memRecallInput,
      async (args, extra) => {
        try {
          return jsonContent(await memRecall(toolDeps(extra), args))
        } catch (e) {
          return errorContent(e instanceof Error ? e.message : "mem_recall failed")
        }
      },
    )

    registerKlTool(
      server,
      "mem_write",
      "Write memory",
      "Record a belief into your private memory (subject, predicate, object, confidence). Belief-revision-aware. Requires the memory:write scope.",
      memWriteInput,
      async (args, extra) => {
        try {
          return jsonContent(await memWrite(toolDeps(extra), args))
        } catch (e) {
          return errorContent(e instanceof Error ? e.message : "mem_write failed")
        }
      },
    )

    registerKlTool(
      server,
      "kl_ingest",
      "Ingest knowledge",
      "Add text to the knowledge base (chunked, embedded, distilled into fact cards, graph-extracted). Requires knowledge:write. Later kl_ask_global / kl_search can cite it.",
      klIngestInput,
      async (args, extra) => {
        try {
          return jsonContent(await klIngest(toolDeps(extra), args))
        } catch (e) {
          return errorContent(e instanceof Error ? e.message : "kl_ingest failed")
        }
      },
    )

    // Layer-2 tool only when GraphRAG is enabled.
    if (knowledgeFeatureFlags().graphragEnabled && getKnowledgeGraphRepo() !== undefined) {
      registerKlTool(
        server,
        "kl_graph_neighbors",
        "Graph neighbors",
        "Find materials related to a given material via the knowledge graph (sharing an extracted entity).",
        klGraphNeighborsInput,
        async (args, extra) => {
          try {
            return jsonContent(await klGraphNeighbors(toolDeps(extra), args))
          } catch (e) {
            return errorContent(e instanceof Error ? e.message : "kl_graph_neighbors failed")
          }
        },
      )
    }
  },
  {
    serverInfo: { name: "agenticmind-knowledge", version: "v1" },
    capabilities: { tools: {} },
  },
  {
    // mcp-handler mounts the streamable transport at `${basePath}/mcp`, so an
    // empty basePath serves it at /mcp — the URL the README documents. (index.ts
    // already routes /mcp here.)
    basePath: "",
    maxDuration: 60,
  },
)

/** Fail-closed bearer verification: signature + typ="mcp" + active jti. */
const verifyMcpAccess = async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  if (bearer === undefined || bearer === "") return undefined
  const verified = await verifyMcpToken(bearer)
  if (verified === null) return undefined
  const check = await checkMcpToken({ tx: getDb(), jti: verified.jti }).unwrapOr({
    active: false as const,
    reason: "unknown" as const,
  })
  if (!check.active) return undefined
  const scopes = check.scopes.length > 0 ? check.scopes : ["knowledge:read"]
  return {
    token: bearer,
    scopes,
    clientId: verified.userUuid,
    extra: { userUuid: verified.userUuid, jti: verified.jti, actorType: check.actorType },
  }
}

/** The MCP fetch handler — bearer-gated, requires knowledge:read at the endpoint. */
export const mcpFetch = withMcpAuth(handler, verifyMcpAccess, {
  required: true,
  requiredScopes: ["knowledge:read"],
})

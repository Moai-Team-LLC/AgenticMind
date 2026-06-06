# AgenticMind + Mastra

Mastra is TypeScript-native (like AgenticMind). Use
[`@mastra/mcp`](https://mastra.ai/reference/tools/mcp-client)'s `MCPClient` — a `url` makes
it use streamable HTTP, with auth headers via `requestInit`.

```bash
npm install @mastra/mcp @mastra/core
```

```ts
import { MCPClient } from "@mastra/mcp"

const MCP_API_KEY = process.env.MCP_API_KEY! // static key or a minted scoped token

const mcp = new MCPClient({
  servers: {
    agenticmind: {
      url: new URL("http://localhost:3000/mcp"),
      requestInit: {
        headers: { Authorization: `Bearer ${MCP_API_KEY}` },
      },
    },
  },
})

const tools = await mcp.getTools() // kl_search, kl_ask_global, kl_ingest, mem_recall, ...

// Hand `tools` to a Mastra Agent:
// const agent = new Agent({ name: "kb", model: ..., tools })
```

For long-lived agents, prefer `mcp.getToolsets()` per request; for a static set, `getTools()`
as above. Use a least-privilege minted token rather than the all-scope static key outside
local dev (see [`docs/security-model.md`](../../docs/security-model.md)).

Docs: [Mastra — MCPClient](https://mastra.ai/reference/tools/mcp-client).

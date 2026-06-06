# Use AgenticMind from an agent framework

AgenticMind needs **no bespoke adapter**. It's a standard streamable-HTTP MCP server, so
every major framework consumes it through its own **native MCP client** — point that client
at the URL + `Authorization: Bearer` header and AgenticMind's `kl_*` / `mem_*` tools show up
as native tools.

| Framework | Guide | Language |
| --- | --- | --- |
| LangChain / LangGraph | [langchain.md](./langchain.md) | Python |
| LlamaIndex | [llamaindex.md](./llamaindex.md) | Python |
| CrewAI | [crewai.md](./crewai.md) | Python |
| Mastra | [mastra.md](./mastra.md) | TypeScript |

The invariant is the same everywhere:

- **URL:** `http://localhost:3000/mcp` (your `https://host/mcp` in prod)
- **Header:** `Authorization: Bearer <token>` — your static `MCP_API_KEY`, or a minted
  least-privilege token (see [`docs/security-model.md`](../../docs/security-model.md))

> Framework MCP-client APIs move fast. The snippets below are accurate as of early 2026;
> if one drifts, keep the URL + bearer invariant and follow that framework's current
> "connect to an MCP server" docs (linked in each guide).

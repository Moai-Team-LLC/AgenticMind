# Examples — connect an agent to AgenticMind

AgenticMind is a **streamable-HTTP MCP server**. Any MCP client connects with two things:

- **URL:** `http://localhost:3000/mcp` (self-hosted; use your `https://host/mcp` in prod)
- **Header:** `Authorization: Bearer <token>` — your static `MCP_API_KEY`, or a minted
  least-privilege JWT (see [`docs/security-model.md`](../docs/security-model.md))

That invariant is all a client needs. The per-client snippets below wire it up.

| Guide | Client |
| --- | --- |
| [claude-code.md](./claude-code.md) | Claude Code (CLI / `.mcp.json`) |
| [cursor.md](./cursor.md) | Cursor (`mcp.json`) |
| [claude-desktop.md](./claude-desktop.md) | Claude Desktop (via `mcp-remote`) |
| [first-run.md](./first-run.md) | End-to-end: ingest → ask → read the why-trace |
| [frameworks/](./frameworks/) | Agent frameworks: LangChain · LlamaIndex · CrewAI · Mastra |

Don't have an instance yet? One command, no clone:

```bash
OPENAI_API_KEY=sk-... sh -c "$(curl -fsSL https://raw.githubusercontent.com/Moai-Team-LLC/AgenticMind/main/quickstart.sh)"
```

> MCP client configuration evolves quickly. If a snippet drifts from your client's current
> format, keep the **URL + Authorization header** invariant and follow that client's own
> "add an HTTP/remote MCP server" docs.

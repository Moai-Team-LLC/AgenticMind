---
title: Integrations — AgenticMind
description: Connect AgenticMind to Claude Code, Cursor, Claude Desktop, and agent frameworks (LangChain, LlamaIndex, CrewAI, Mastra) over MCP.
---

# Integrations

AgenticMind is a **streamable-HTTP MCP server**. Any client connects with two things:

- **URL:** `http://localhost:3000/mcp` (self-hosted; your `https://host/mcp` in prod)
- **Header:** `Authorization: Bearer <token>` — your static `MCP_API_KEY`, or a minted
  least-privilege token (see the [security model](security-model.md))

A generic MCP client config:

```jsonc
{
  "mcpServers": {
    "agenticmind": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer ${MCP_API_KEY}" }
    }
  }
}
```

## MCP clients

Step-by-step guides (in the repo's `examples/`):

- **[Claude Code](https://github.com/Moai-Team-LLC/AgenticMind/blob/main/examples/claude-code.md)** — CLI or `.mcp.json`
- **[Cursor](https://github.com/Moai-Team-LLC/AgenticMind/blob/main/examples/cursor.md)** — `~/.cursor/mcp.json`
- **[Claude Desktop](https://github.com/Moai-Team-LLC/AgenticMind/blob/main/examples/claude-desktop.md)** — via `mcp-remote`

## Agent frameworks

AgenticMind needs no bespoke adapter — each framework's native MCP client loads its tools:

- **[LangChain / LangGraph](https://github.com/Moai-Team-LLC/AgenticMind/blob/main/examples/frameworks/langchain.md)**
- **[LlamaIndex](https://github.com/Moai-Team-LLC/AgenticMind/blob/main/examples/frameworks/llamaindex.md)**
- **[CrewAI](https://github.com/Moai-Team-LLC/AgenticMind/blob/main/examples/frameworks/crewai.md)**
- **[Mastra](https://github.com/Moai-Team-LLC/AgenticMind/blob/main/examples/frameworks/mastra.md)**

## First run

End-to-end (ingest → ask → read the why-trace):
**[examples/first-run](https://github.com/Moai-Team-LLC/AgenticMind/blob/main/examples/first-run.md)**.

The full cookbook lives in
[`examples/`](https://github.com/Moai-Team-LLC/AgenticMind/tree/main/examples).

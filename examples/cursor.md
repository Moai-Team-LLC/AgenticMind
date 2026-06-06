# Connect AgenticMind to Cursor

Cursor reads MCP servers from `mcp.json` — `~/.cursor/mcp.json` (global) or
`.cursor/mcp.json` (per-project).

```jsonc
{
  "mcpServers": {
    "agenticmind": {
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer YOUR_MCP_API_KEY" }
    }
  }
}
```

Replace `YOUR_MCP_API_KEY` with your static `MCP_API_KEY` or a minted token. Restart Cursor
(or toggle the server in **Settings → MCP**); AgenticMind's tools then appear to the agent.

> A project-level `.cursor/mcp.json` is convenient for a team, but don't commit a real key
> — use a placeholder and have each developer fill in their own, or point at a shared
> instance with a scoped read token.

## Least privilege

For a retrieval-only setup, mint a `knowledge:read,memory:read` token rather than using the
all-scope static key:

```bash
bun run issue-token -- --label "cursor-readonly" --scopes knowledge:read,memory:read
```

See [`docs/security-model.md`](../docs/security-model.md).

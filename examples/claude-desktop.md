# Connect AgenticMind to Claude Desktop

Claude Desktop's config file launches MCP servers over **stdio**. AgenticMind is an HTTP
server, so bridge it with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), which
proxies a remote/HTTP MCP server into a stdio one.

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "agenticmind": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "http://localhost:3000/mcp",
        "--header", "Authorization: Bearer YOUR_MCP_API_KEY"
      ]
    }
  }
}
```

Restart Claude Desktop fully (quit, not just close the window). AgenticMind's tools then
appear under the connect/tools menu.

> **Header with spaces.** Some `mcp-remote` versions mis-split a header that contains a
> space. If the bearer doesn't take, pass it as one token —
> `"--header", "Authorization:Bearer YOUR_MCP_API_KEY"` — or set it via an env var per the
> `mcp-remote` docs.

> **Native connectors.** If your Claude plan exposes **Settings → Connectors → Add custom
> connector**, you can instead paste the `http://localhost:3000/mcp` URL directly and skip
> `mcp-remote`. Availability varies by plan.

## Least privilege

Prefer a minted scoped token over the all-scope static key:

```bash
bun run issue-token -- --label "claude-desktop-readonly" --scopes knowledge:read,memory:read
```

See [`docs/security-model.md`](../docs/security-model.md).

# Connect AgenticMind to Claude Code

Claude Code speaks MCP over HTTP natively.

## Option A — CLI (fastest)

```bash
claude mcp add --transport http agenticmind http://localhost:3000/mcp \
  --header "Authorization: Bearer $MCP_API_KEY"
```

Add `--scope user` to make it available in every project, or `--scope project` to commit
it to the repo's `.mcp.json` for your team.

## Option B — `.mcp.json` (checked into a project)

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

Using `${MCP_API_KEY}` keeps the secret out of the committed file — set it in your
environment.

## Verify

```bash
claude mcp list           # agenticmind should show ✓ connected
```

In a session, the `kl_*` and `mem_*` tools are now available. Try the end-to-end flow in
[first-run.md](./first-run.md).

## Least privilege

The static `MCP_API_KEY` grants all scopes. For a read-only assistant, mint a scoped token
instead and use it as the bearer:

```bash
bun run issue-token -- --label "claude-code-readonly" --scopes knowledge:read,memory:read
```

See [`docs/security-model.md`](../docs/security-model.md) for the scope model.

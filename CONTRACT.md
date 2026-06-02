# AgenticMind MCP Tool Contract

The stable, versioned surface that agents and products build on. The contract is
the set of MCP **tool names**, their **input schemas**, and the **scopes** they
require. It is surfaced to clients as `serverInfo.version` and guarded in CI by a
snapshot test (`packages/shared/src/lib/knowledge/mcp-contract.test.ts`).

**Current version: `1.1.0`** (see `MCP_CONTRACT_VERSION` in
`packages/shared/src/lib/knowledge/mcp-tools.ts`).

## Tools

| Tool | Scope | Required input | Optional input |
| --- | --- | --- | --- |
| `kl_search` | `knowledge:read` | `q` | `limit` |
| `kl_ask_global` | `knowledge:read` | `question` | `intent`, `facts` |
| `kl_get_material` | `knowledge:read` | `id` | — |
| `kl_graph_neighbors` | `knowledge:read` | `materialId` | `limit` |
| `kl_ingest` | `knowledge:write` | `title`, `text` | — |
| `kl_forget` | `knowledge:admin` | `id` | — |
| `kl_signal` | `knowledge:signal` | `askId`, `signal` | `strength`, `note` |
| `mem_recall` | `memory:read` | — | `subject`, `query`, `asOf`, `includeShared`, `limit` |
| `mem_write` | `memory:write` | `subject`, `predicate`, `object` | `confidence`, `embed` |

`kl_graph_neighbors` is exposed only when GraphRAG is enabled
(`KNOWLEDGE_GRAPHRAG_ENABLED=true`). All write/signal tools assert their scope in
code (fail-closed); `kl_forget` requires the elevated `knowledge:admin` (strictly
above `knowledge:write`); read tools require `knowledge:read` at the endpoint.

## Versioning policy (SemVer)

The contract version is independent of the package/release version.

- **PATCH** (`x.y.Z`) — wording-only changes to a tool description; no shape change.
- **MINOR** (`x.Y.0`) — **additive, backward-compatible**: a new tool, or a new
  **optional** input field. Existing clients keep working.
- **MAJOR** (`X.0.0`) — **breaking**: a tool removed or renamed, an input field
  removed or renamed, or a field becoming **required**. Requires a deprecation
  notice (see below).

Any change to the tool set or an input schema must bump `MCP_CONTRACT_VERSION` in
the same PR and update the snapshot test — otherwise the contract test fails. This
makes every contract change deliberate and reviewed.

## Deprecation

Breaking a tool or field follows a two-step path:

1. Mark it deprecated in the tool description and in this file, ship the
   replacement alongside it (MINOR bump).
2. Remove it no earlier than the next MAJOR, after a deprecation window.

Never remove or repurpose a tool/field silently within a MAJOR line.

## Stability guarantee

Within a MAJOR line, a product that pins `serverInfo.version` to `1.x` can rely on:

- every tool listed above remaining present with the same name and scope,
- every required input staying required and every optional input staying optional,
- no input field changing type.

New optional fields and new tools may appear (MINOR) — clients should ignore
unknown fields and tools they don't use.

## MCP registry

`server.json` at the repo root is the machine-readable manifest for MCP
registries (the official MCP registry, Smithery, mcp.so). It follows the
official `server.schema.json` (`2025-12-11`): reverse-DNS `name`
(`io.github.Moai-Team-LLC/agenticmind`), `version` mirroring this contract
(`1.1.0`), the `repository`, and a `streamable-http` `remotes` entry pointing at
`{baseUrl}/mcp` (default `http://localhost:3000`) with a required, secret
`Authorization: Bearer …` header (the fail-closed `typ="mcp"` JWT).

The nine tools above are listed under
`_meta."io.modelcontextprotocol.registry/publisher-provided".tools` (the schema
caps `description` at 100 chars, so the full surface lives in `_meta` rather than
the description). When the tool set or `MCP_CONTRACT_VERSION` changes, bump
`server.json`'s `version` and its tool list in the same PR.

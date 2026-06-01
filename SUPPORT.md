# Support

Need help running or integrating AgenticMind? Here's where to go.

## Where to go

| You want to… | Go to |
| --- | --- |
| **Ask a question** (setup, integration, "how do I…") | [GitHub Discussions](https://github.com/Moai-Team-LLC/AgenticMind/discussions) |
| **Report a bug** | [Open an issue](https://github.com/Moai-Team-LLC/AgenticMind/issues/new/choose) |
| **Request a feature** | [Open an issue](https://github.com/Moai-Team-LLC/AgenticMind/issues/new/choose) |
| **Contribute code** | [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Report a security issue** | [SECURITY.md](SECURITY.md) — private advisory, not a public issue |

## Before you open an issue

Most setup problems are covered already:

- **[Quickstart](README.md#-quickstart)** — clone → `cp .env.example .env.local` → `./setup.sh` → `bun run dev`.
- **Retrieval needs no cloud key** — embeddings run locally (bge-m3). Only *synthesis*
  (`kl_ask_global`) needs a chat model: set `OPENROUTER_API_KEY`, or point `CHAT_PROVIDER=openai`
  + `CHAT_BASE_URL` at a local Ollama.
- **`401` from the MCP endpoint** — the surface is fail-closed; mint a token with
  `bun run scripts/issue-mcp-token.ts` and send it as `Authorization: Bearer …`.
- **SSL errors against managed Postgres** — set `DATABASE_SSL=true` (local Docker ships `false`).
- **Lint/tooling** — lint needs Node ≥22.18 (see `.nvmrc`); the app itself runs on Bun ≥1.3.

When reporting, include: OS, Bun version, whether Postgres is the bundled Docker one or managed,
and the failing command's output.

Maintained by [Moai Team LLC](https://moaiteam.com). Best-effort, no SLA.

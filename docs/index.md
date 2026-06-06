---
title: AgenticMind — auditable knowledge & memory for AI agents
description: >-
  Grounded answers with provable citations, a replayable why-trace for every
  answer, and a self-improving corpus — served to any agent over MCP. Self-hosted
  on Postgres alone. Apache-2.0.
---

# AgenticMind

The **auditable, self-improving knowledge & memory layer for AI agents** — grounded
answers with **provable citations**, a full **why-trace** for every answer, and a corpus
that **improves itself**, served to any agent over **MCP**. Zero-key, multilingual, and
self-hostable on **Postgres alone**. Apache-2.0.

!!! quote ""
    **Not "memory storage for an agent."** It's the substrate an agent points at when it
    needs answers it can **trust**, a trail it can **audit**, and a knowledge base that
    **compounds**. No source, no claim — and a receipt for every answer.

## Run it — no clone (~1 min)

Needs Docker (Compose v2.23+) and an OpenAI-compatible key:

```bash
OPENAI_API_KEY=sk-... sh -c "$(curl -fsSL https://raw.githubusercontent.com/Moai-Team-LLC/AgenticMind/main/quickstart.sh)"
```

The MCP endpoint comes up at `http://localhost:3000/mcp`, authenticated with a single static
bearer (`MCP_API_KEY`, auto-generated). Point Claude Code / Cursor at it with the
`Authorization: Bearer <MCP_API_KEY>` header. Embeddings run **locally** (zero-key); only
synthesis uses your chat key.

Connect guides for [Claude Code, Cursor, Claude Desktop, and agent frameworks](https://github.com/Moai-Team-LLC/AgenticMind/tree/main/examples)
live in the repo's `examples/`.

## Start here

- **[The why-trace](blog/why-trace.md)** — why every answer ships a replayable, citation-keyed receipt.
- **[Postgres-only](blog/postgres-only.md)** — vectors, full-text, graph, and the queue in one database.
- **[Provenance is the differentiator](blog/auditability-vs-memory-sdks.md)** — the axis that survives commoditization.
- **[Safe by construction](blog/safe-by-construction.md)** — the security posture in context.
- **[Security model](security-model.md)** — auth, scopes, RLS, data residency.
- **[Deploy](DEPLOY.md)** · **[Operations](OPERATIONS.md)** — running it for real.

## Ecosystem

AgenticMind is the flagship **reference implementation** of the
[Agentic Product Standard](https://github.com/Moai-Team-LLC/agentic-product-standard) — the
open standard (plus Claude Code skills) for building production-grade agentic products.

[:material-github: Source on GitHub](https://github.com/Moai-Team-LLC/AgenticMind){ .md-button .md-button--primary }

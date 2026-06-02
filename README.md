<div align="center">

<img src="assets/agenticmind-logo.png" alt="AgenticMind" width="118" />

# AgenticMind

### The auditable, self-improving knowledge & memory layer for AI agents.

Grounded answers with **provable citations**, a full **why-trace** for every answer,
and a corpus that **improves itself** — served to any agent over **MCP**.
**Zero-key, multilingual, and self-hostable on Postgres alone.**

[![CI](https://github.com/Moai-Team-LLC/AgenticMind/actions/workflows/ci.yml/badge.svg)](https://github.com/Moai-Team-LLC/AgenticMind/actions/workflows/ci.yml)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://www.conventionalcommits.org)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Implements: Agentic Product Standard](https://img.shields.io/badge/implements-Agentic%20Product%20Standard-CD7722.svg)](https://github.com/Moai-Team-LLC/agentic-product-standard)
[![Runtime: Node or Bun](https://img.shields.io/badge/runtime-Node%20or%20Bun-black.svg)](https://nodejs.org)
[![DB: Postgres + pgvector](https://img.shields.io/badge/db-Postgres%20%2B%20pgvector-336791.svg)](https://github.com/pgvector/pgvector)
[![Stars](https://img.shields.io/github/stars/Moai-Team-LLC/AgenticMind?style=social)](https://github.com/Moai-Team-LLC/AgenticMind/stargazers)

**[Quickstart](#-quickstart)** · **[See it work](#-see-it-work)** · **[Agent tools](#-agent-surface-mcp)** · **[How it works](#-how-it-works)** · **[Why](#-why-agenticmind)** · **[The Standard ↗](https://github.com/Moai-Team-LLC/agentic-product-standard)**

<sub>If this is useful, a ⭐ helps others find it — and tells us to keep going.</sub>

</div>

---

> **Not "memory storage for an agent."** AgenticMind is the substrate an agent points
> at when it needs answers it can **trust**, a trail it can **audit**, and a knowledge
> base that **compounds**.

Most agent memory is a vector store with `save()` and `search()`. That buys you fuzzy
recall and zero accountability: you can't tell _why_ an answer came back, whether it's
current, or whether a source even supports it. AgenticMind treats knowledge as a
first-class, auditable, self-improving substrate — and exposes it to any agent over the
Model Context Protocol.

## ✨ Why AgenticMind

- 📌 **Citation-enforced** — every claim in an answer is keyed to a numbered source. No source, no claim.
- 🔍 **Fully auditable** — a replayable _why-trace_ for every answer: what was retrieved, ranked, and used.
- ♻️ **Self-improving** — validated answers are promoted back into the corpus by a judge-gated compounding loop, driven by **programmatic signals** (not human thumbs).
- 🧩 **Tiered retrieval** — chunks → typed fact cards → knowledge graph; hybrid vector + full-text, recency-aware.
- 🔐 **Safe by construction** — scoped, least-privilege MCP tokens, fail-closed auth, guardrails on input _and_ output.
- 🐘 **One datastore** — Postgres + pgvector carries vectors, full-text, the graph (recursive CTE), _and_ the durable queue. No Redis, no Neo4j, no vector-DB sprawl.

## 🔧 How it works

```mermaid
flowchart TD
  A["🤖 Agent"] -->|"MCP request"| R["Tiered retrieval<br/>pgvector + full-text + graph"]
  R --> Y["Citation-enforced synthesis"]
  Y -->|"grounded answer + [citations]"| A
  Y --> T[("Replayable why-trace")]
  Y -->|"programmatic signals"| L["Judge-gated compounding loop"]
  L -->|"promotes validated knowledge"| R
```

A request comes in over MCP → the engine retrieves across three tiers → synthesises an
answer where **every claim cites a source** → logs a replayable trace → and feeds
programmatic signals into a loop that promotes validated knowledge back into the corpus.

## 🎬 See it work

A real `kl_ask_global` call against a corpus seeded with the Agentic Product Standard. The
question deliberately has **two halves** — one the corpus can answer, one it can't:

<div align="center">
  <img src="assets/demo.gif" alt="A live kl_ask_global call: a citation-enforced answer that refuses the unsupported half, with a replayable why-trace" width="780" />
</div>

```jsonc
// → kl_ask_global
{ "question": "When should I use a multi-agent architecture instead of a single agent,
                and what must every agent ship with according to the standard?" }

// ← response (trimmed)
{
  "answer": "The provided sources do not specify when to use a multi-agent architecture
             versus a single agent. … According to the Agentic Product Standard, every
             agent must ship with a written Agent Contract [1]. This contract must cover
             ownership, forbidden actions, acceptance criteria, failure modes, escalation
             rules, and logging requirements [1].",
  "citations": [
    { "number": 1, "title": "Agent Contract requirement",
      "materialId": "ba44971b-…", "score": 0.46, "origin": "chunk" }
  ],
  "model": "google/gemini-3.1-flash-lite-preview",
  "retrievalMs": 606, "generationMs": 890,
  "phases": [ {"phase":"embed","ms":552}, {"phase":"retrieve","ms":37},
              {"phase":"synth","ms":890}, {"phase":"output_filter","ms":2} ],
  "telemetryId": "cc942e54-…"
}
```

**Look at what *didn't* happen.** The half the corpus couldn't support, the model **refused to
answer** — *"the provided sources do not specify…"* — instead of fabricating it. The half it
could support is keyed to a numbered citation you can open. And every answer comes with a
**why-trace** (`phases`, `model`, `telemetryId`) you can replay. That's the whole pitch in one
call: **no source, no claim — and a receipt for every answer.**

## 🆚 How it's different

|                         | Plain RAG / memory SDKs | AgenticMind                        |
| ----------------------- | ----------------------- | ---------------------------------- |
| Grounded answers        | sometimes               | citation-enforced + post-checked   |
| Why-trace per answer    | ✗                       | full decision trace                |
| Self-improving corpus   | ✗                       | compounding loop (judge-gated)     |
| Relational verification | ✗                       | graph module                       |
| Runs on                 | varies                  | **Postgres + pgvector** (flagship) |

## 🛠 Agent surface (MCP)

A **headless** service (`apps/server`) exposes the engine as MCP tools over
streamable HTTP, with fail-closed per-token bearer auth (scoped, least-privilege):

| Tool                 | Scope              | Purpose                                                             |
| -------------------- | ------------------ | ------------------------------------------------------------------- |
| `kl_search`          | `knowledge:read`   | semantic / keyword passage search                                   |
| `kl_ask_global`      | `knowledge:read`   | synthesised answer + citations (optional `intent`/`facts`)          |
| `kl_get_material`    | `knowledge:read`   | fetch a material by id                                              |
| `kl_graph_neighbors` | `knowledge:read`   | related materials via the knowledge graph                           |
| `kl_ingest`          | `knowledge:write`  | add text (chunked, embedded, distilled into cards, graph-extracted) |
| `kl_forget`          | `knowledge:admin`  | delete a material + all derived chunks/cards/graph (inverse of ingest) |
| `kl_signal`          | `knowledge:signal` | emit a programmatic compounding signal on a prior answer            |
| `mem_recall`         | `memory:read`      | recall beliefs (private ∪ shared); semantic or `asOf` time-travel   |
| `mem_write`          | `memory:write`     | record a belief into private memory (bitemporal, revision-aware)    |

There is **no frontend** — the only consumers are agents over MCP. The tool logic is
framework-agnostic in `packages/shared/src/lib/knowledge/mcp-tools.ts`; the host is a
~60-line Web-standard `fetch` handler served by Node or Bun.

## 🚀 Quickstart

Requires Docker and **Node ≥22.18** (or **Bun ≥1.3**) — the server and worker run on plain Node or Bun.

```bash
git clone https://github.com/Moai-Team-LLC/AgenticMind.git
cd AgenticMind
cp .env.example .env.local         # set AUTH_SECRET (+ a chat key OR local Ollama)
./setup.sh                         # picks npm or bun, starts Postgres, runs migrations
npm run dev                        # headless MCP server on :3000  (or: bun run dev)
```

**Embeddings run locally by default** — a zero-key, offline, multilingual model
(bge-m3) downloads on first use, so retrieval needs no cloud key. Only the
*synthesis* step needs a chat model: OpenRouter (`OPENROUTER_API_KEY`) or any
OpenAI-compatible endpoint like a local Ollama (`CHAT_PROVIDER=openai`,
`CHAT_BASE_URL=…`). See `.env.example`.

Verify the build with `npm run check` (typecheck + tests) — `bun run check` works too.

The MCP endpoint is fail-closed, so you need a bearer `typ="mcp"` JWT. The headless
server ships no admin UI — mint one with the issuance script (it reads `DATABASE_URL`
+ `AUTH_SECRET` from your `.env.local`):

```bash
npm run issue-token -- --label "claude-code" --ttl-days 365   # or: bun run issue-token --label …
# prints the bearer on the last line — capture it, it is not stored in plaintext
```

Then point an MCP client at `http://localhost:3000/mcp` with that token as the
`Authorization: Bearer …` header. (Lint additionally requires Node ≥22.18 — see `.nvmrc`.)

> **Note.** The local Docker Postgres has no TLS, so `.env.example` ships
> `DATABASE_SSL=false` and `DATABASE_URL` on host port `5435`. For managed Postgres
> (Supabase, RDS, …) that requires SSL, set `DATABASE_SSL=true`.

## 🧱 Layout

```text
packages/shared/src/lib/knowledge/        ← the tiered engine (the product)
packages/shared/src/lib/ai/               ← chat + embeddings (provider-agnostic; local embeddings by default)
packages/shared/src/database/             ← Drizzle schema + queries (Postgres + pgvector)
apps/server/src/{index,mcp}.ts            ← headless MCP host, Node or Bun (agent surface)
apps/worker/src/jobs/knowledge-feedback/  ← Postgres-scheduled compounding sweep
```

**Architecture notes.** Agent-first and **Postgres-only**: the graph lives behind a
`GraphStore` interface (recursive-CTE traversal on Postgres, no extra service),
compounding is driven by programmatic signals, MCP tokens are scoped least-privilege, the
agent principal is slim, and the host is a headless Node/Bun HTTP server. Retrieval is **multilingual by
default** — local `bge-m3` embeddings cover many languages with zero keys; full-text search
uses the language-agnostic `simple` config (configurable per deployment).

## 🌐 Ecosystem

AgenticMind is the flagship **reference implementation** of
**[the Agentic Product Standard](https://github.com/Moai-Team-LLC/agentic-product-standard)** —
the open standard (plus Claude Code skills) for building production-grade agentic products.

|     | Repo                                                                                    | Use it when                                                                                         |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 📐  | **[agentic-product-standard](https://github.com/Moai-Team-LLC/agentic-product-standard)** | You're **designing or building** an agent / agentic product — the standard + skills tell you _how_. |
| 🧠  | **AgenticMind** (this repo)                                                             | You need a **knowledge & memory layer** for your agent — a working implementation you can run.      |

See the standard's [AgenticMind case study](https://github.com/Moai-Team-LLC/agentic-product-standard/blob/main/examples/agenticmind-case-study.md) for a layer-by-layer map of how this repo implements the canon.

## 🤝 Contributing & license

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).

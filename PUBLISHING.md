# Listing AgenticMind in MCP directories

AgenticMind is a **self-hosted** MCP server: you run your own instance and the corpus is
yours. There is no shared hosted endpoint and no published npm/PyPI package — the
installable artifact is the **GHCR container image**
(`ghcr.io/moai-team-llc/agenticmind-server`, multi-arch, signed). So "publishing" here means
getting AgenticMind **discovered** in the community directories, then pointing people at the
[Quickstart](README.md#-quickstart) to stand up their own instance.

> **Not the official MCP Registry.** `registry.modelcontextprotocol.io` is designed for
> servers reachable at a single canonical URL; a bring-your-own-host self-hosted server has
> no globally-unique remote URL, so it doesn't fit (the registry rejects duplicate/templated
> remote URLs). AgenticMind therefore ships **no `server.json`** and is not listed there by
> design. Discovery happens through the directories below.

---

## Where to list

### awesome-mcp-servers (the discovery anchor)

The canonical community list; other directories (e.g. Glama) crawl from it. Open a PR adding
AgenticMind to the **Knowledge & Memory** section:

> `[AgenticMind](https://github.com/Moai-Team-LLC/AgenticMind) - Auditable, self-improving knowledge & memory for AI agents over MCP. Citation-enforced answers + replayable why-trace, Postgres-only, self-hostable. Apache-2.0.`

### Glama (glama.ai)

Auto-crawls GitHub for MCP servers. A repo with good topics + an awesome-mcp-servers listing
is usually picked up automatically; you can also claim/enrich the entry on glama.ai.

### Smithery (smithery.ai)

Connect the repo via Smithery's GitHub app / "Add server". List it as a **remote /
self-hosted** server and point users at the Quickstart.

### mcp.so · PulseMCP

Community directories with a web "Submit" form. Use the pitch below; deploy type =
self-hosted, referencing the GHCR image as the installable artifact.

---

## The pitch (copy/paste for any submission)

> **AgenticMind** — an auditable, self-improving knowledge & memory layer for AI agents,
> served over MCP. Citation-enforced answers (no source, no claim), a replayable why-trace
> per answer, and a judge-gated loop that promotes validated knowledge back into the corpus.
> Zero-key local embeddings, multilingual, self-hosted on Postgres + pgvector alone — no
> Redis, no vector-DB sprawl. Apache-2.0. Reference implementation of the Agentic Product
> Standard.

**Tags:** `mcp` · `agents` · `memory` · `knowledge` · `rag` · `postgres` · `pgvector` ·
`self-hosted` · `apache-2.0`

---

## Before you submit — checklist

- [ ] Repo **topics** set (the tags above) so directory crawlers categorize it.
- [ ] README Quickstart current (the one-command `quickstart.sh` install).
- [ ] Client connect guides linked ([`examples/`](examples/)).
- [ ] GHCR image builds on the latest release (multi-arch, signed — see
      [`.github/workflows/release-images.yml`](.github/workflows/release-images.yml)).
- [ ] Custom social/OG card set (optional — improves directory thumbnails).

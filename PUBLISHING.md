# Publishing AgenticMind to MCP registries

AgenticMind ships a ready, schema-valid [`server.json`](server.json) describing its MCP
surface. This guide lists where to publish it and the exact steps. Registry discovery is the
main way agents (and their humans) find an MCP server, so it's worth doing.

> **One thing to know first.** AgenticMind is a **self-hosted remote** server (you run your own
> instance; the corpus is yours). Its `server.json` therefore uses a `remotes` entry with a
> `{baseUrl}` the operator fills in — *not* a published npm/PyPI package. That's intentional.
> Registries that support self-hosted / remote-template servers (Smithery, mcp.so, the official
> registry's remote entries) are the right fit.

---

## 1. Official MCP Registry (`registry.modelcontextprotocol.io`)

The canonical registry. Requires the `mcp-publisher` CLI and a GitHub login that can publish
under the `io.github.Moai-Team-LLC/*` namespace (i.e. a Moai-Team-LLC org member).

```bash
# a) install the CLI (macOS/Linux) — see releases for the current method
brew install mcp-publisher            # or download the binary from the registry releases

# b) authenticate — opens https://github.com/login/device (INTERACTIVE: needs a human)
mcp-publisher login github

# c) validate + publish the server.json in this repo root
mcp-publisher publish
```

- **Namespace.** `server.json` `name` is `io.github.Moai-Team-LLC/agenticmind`. The GitHub
  account you log in with must have access to the **Moai-Team-LLC** org, or the publish is
  rejected.
- **Interactive step.** `mcp-publisher login github` is a device-code OAuth flow — it can't be
  fully automated from a script. Run it once by hand.
- **Automated alternative.** The "Publish MCP Server" GitHub Action can publish on release via
  GitHub OIDC (no manual device login). Grab the current action ref from the
  [GitHub Marketplace](https://github.com/marketplace/actions/publish-mcp-server) and wire it to
  a `release: published` trigger if you want CI to publish on each tag.

Docs: **[Quickstart: Publish an MCP Server](https://modelcontextprotocol.io/registry/quickstart)**.

## 2. Smithery (`smithery.ai`)

Smithery indexes GitHub repos. Connect the repo through their GitHub app / "Add server" flow;
it reads the MCP config and lists the server. Because AgenticMind is self-hosted, list it as a
remote/self-hosted server and point users at the [Quickstart](README.md#-quickstart) to stand
up their own instance + mint a token.

## 3. mcp.so

Community directory. Submit via their site's "Submit" form (or the PR-based flow if their repo
is open) with the repo URL and a short description. Reuse the one-liner from `server.json`:
*"Auditable, self-improving knowledge & memory layer for AI agents over MCP."*

## 4. GitHub MCP Registry

If/when listing in the [GitHub MCP Registry](https://github.blog/ai-and-ml/generative-ai/how-to-find-install-and-manage-mcp-servers-with-the-github-mcp-registry/),
the same `server.json` + repo metadata applies.

---

## The pitch (copy/paste for any submission form)

> **AgenticMind** — an auditable, self-improving knowledge & memory layer for AI agents,
> served over MCP. Citation-enforced answers (no source, no claim), a replayable why-trace per
> answer, and a judge-gated loop that promotes validated knowledge back into the corpus.
> Zero-key and multilingual by default, self-hosted on Postgres + pgvector alone — no Redis,
> no vector-DB sprawl. Apache-2.0. Reference implementation of the Agentic Product Standard.

## Before you publish — checklist

- [ ] `server.json` validates (`mcp-publisher publish` validates against the schema, or check
      against the `$schema` URL in the file).
- [ ] Version in `server.json` matches the release tag you intend to advertise.
- [ ] README Quickstart is current (token minting, env vars).
- [ ] Tags/topics set on the GitHub repo (`mcp`, `agents`, `memory`, `rag`, `postgres`,
      `pgvector`) so directory crawlers categorize it.

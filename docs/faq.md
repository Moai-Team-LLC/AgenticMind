---
title: FAQ — AgenticMind
description: Common questions about AgenticMind — what it is, how it differs from a vector store, running it, data residency, security, and licensing.
---

# FAQ

## What is AgenticMind?

An **auditable, self-improving knowledge & memory layer for AI agents**, served over MCP.
Answers are **citation-enforced** (no source, no claim) and carry a replayable **why-trace**.
It's self-hosted on **Postgres alone**, Apache-2.0, and maintained by **Moai Team LLC**.

## How is it different from a vector store or memory SDK?

Plain memory gives you fuzzy recall and zero accountability. AgenticMind **refuses
unsupported answers**, keys every claim to a numbered source, records a **replayable
why-trace**, and promotes validated knowledge through a **judge-gated compounding loop**. The
differentiator is **provenance and governance**, not raw recall — see
[Provenance is the differentiator](blog/auditability-vs-memory-sdks.md).

## How do I run it?

One command, no clone:

```bash
OPENAI_API_KEY=sk-... sh -c "$(curl -fsSL https://raw.githubusercontent.com/Moai-Team-LLC/AgenticMind/main/quickstart.sh)"
```

It needs Docker and an OpenAI-compatible key. Embeddings run **locally** with zero keys.

## Does my data leave my infrastructure?

No. AgenticMind is **self-hosted** and runs embeddings **locally** (bge-m3), so ingested text
stays in your Postgres. Only the optional **synthesis** step calls your configured chat model.

## Is it secure and multi-tenant?

The MCP endpoint is **fail-closed** and bearer-gated with **least-privilege, revocable
scopes**, and every request runs inside a Postgres **row-level-security tenant context**. See
the [security model](security-model.md).

## What is the license and who maintains it?

**Apache-2.0**, maintained by **Moai Team LLC**. AgenticMind is the reference implementation
of the [Agentic Product Standard](https://github.com/Moai-Team-LLC/agentic-product-standard).

# AGENTS.md

Guidance for AI agents and coding assistants working in this repository.

## What this is

**AgenticMind** is an auditable, self-improving **knowledge & memory substrate**
for AI agents, served over the **Model Context Protocol (MCP)**. It is *not* an
agent and has no agent loop — the consuming product owns that. AgenticMind owns
one concern: answers an agent can trust (citation-enforced + a replayable
why-trace), a memory that compounds (judge-gated), exposed as MCP tools.

## It implements a standard — read it first

AgenticMind is the **reference implementation of the Agentic Product Standard**.
If you are designing or building an agentic product (architecture, harness,
memory, evals, tools/MCP, durable execution), read the canon and use its skills:

➡️ **https://github.com/Moai-Team-LLC/agentic-product-standard**

When a product needs the **memory / knowledge layer** (the Standard's Layer 4),
AgenticMind *is* that layer — point the agent's MCP client at it instead of
reinventing retrieval, grounding, and a self-improving corpus.

## Commands

```bash
bun run check        # format + lint + tsc + tests (the full gate)
bun test             # unit tests
bun run tsc          # typecheck
bun run build-eval   # regenerate the eval suite (self-validating)
bun run seed-eval    # ingest the eval corpus into a DB
bun run eval         # run the eval suite (needs DB + a chat key)
bun run reembed      # recompute embeddings after a dimension change
```

Lint (`oxlint`) needs Node ≥22.18 (see `.nvmrc`); the rest run under Bun.

## Conventions (please honor)

- **Conventional Commits**, enforced by commitlint + a husky `commit-msg` hook
  and a PR CI check. Header ≤72 chars. See `CONTRIBUTING.md`.
- **The MCP tool contract is versioned and frozen** (`MCP_CONTRACT_VERSION`,
  `CONTRACT.md`). A snapshot test guards it — any change to a tool's name/shape
  must bump the version and update the test in the same change.
- **Every new failure mode becomes a permanent eval case.** Don't add behavior
  without a test; don't add a tool without a contract entry.
- **No secrets, PII, or domain-private data** in code, tests, or fixtures.
- Functional style, `neverthrow` Result types, strict TypeScript.

## Where things live

```text
packages/shared/src/lib/knowledge/   ← the tiered engine (the product)
packages/shared/src/lib/ai/          ← pluggable embeddings + chat providers
packages/shared/src/database/        ← Drizzle schema + queries (Postgres + pgvector)
apps/server/src/{index,mcp}.ts       ← headless Bun MCP host (the agent surface)
apps/worker/src/                     ← the compounding sweep (self-improvement)
eval/                                ← grounded eval suite + corpus
```

## packages/assurance (`@agenticmind/assurance`) — AAL Evidence

The enterprise compliance & evidence layer of the Agent Assurance Layer. It consumes **AAL Core**'s
structured findings (`aal scan --json`), maps target facts to the control catalog
(`catalog/aal-control-catalog.yaml` — AIUC-1 / OWASP ASI / ISO 42001), harvests evidence from the
engine's existing artifacts, scores every control Green/Yellow/Red, and emits an auditor bundle.

**Native-OK, unlike AAL Core.** This package MAY (and does) import `@agenticmind/shared` — deep
native integration is the point. AAL Core stays framework-neutral; the coupling lives only here.

**Four hard rules (never weaken):**
1. **No Green on absence of evidence.** A control with no collected evidence is `not_verified`
   (YELLOW) at best. A control with a **failing Plane-A test is RED**, regardless of any declared
   mitigation (tests beat claims).
2. **Evidence is immutable & sourced.** Every record is insert-only, timestamped, and references a
   real source id/hash (`guard_events.id`, an `ask-telemetry` id, a `tool_audit_events` id, the
   `.mcp-tools.lock` hash). Hash-not-text: no raw incident payloads.
3. **Honest coverage.** Every bundle states its coverage ratio (auto-collected native vs.
   generic/manual/none). Never over-claim.
4. **Remediation is structural-only** (when the autonomy ladder lands): prompts/context/manifests/
   declared-mitigations — never a side-effecting tool, permission, or trust boundary (Cycle of Trust).

**Where its data lives:** evidence is derived on demand from existing engine tables
(`guard_events`, `ask-telemetry`, `mcp-tokens`, `tool_audit_events`); the layer's own persisted
tables (`control_status`, `evidence_records`, run history) land with the drift/continuous-assurance
step (FR-10). Native reads: `src/evidence/collect-db.ts`.

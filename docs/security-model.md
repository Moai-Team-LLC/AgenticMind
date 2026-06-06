# Security model

How AgenticMind is built to be safe by construction. This is the architecture/posture
document; for **reporting** a vulnerability see [`SECURITY.md`](https://github.com/Moai-Team-LLC/AgenticMind/blob/main/SECURITY.md).

> TL;DR — The `/mcp` endpoint is **fail-closed** and bearer-gated. Tokens are
> **scoped, least-privilege, and revocable**. Every request runs inside a
> **Postgres row-level-security tenant context**. Tool arguments are **schema-validated**;
> answers are **citation-enforced and faithfulness-checked**. The corpus is
> **self-hosted** and embeddings run **locally** — your data does not leave your instance
> to be indexed.

## Threat model (what this defends against)

AgenticMind is a knowledge/memory layer that agents call over MCP. The assets are the
**corpus** (possibly sensitive documents), the **memory** (beliefs), and the **answers**
(which downstream agents act on). The threats we design against:

| Threat | Defense |
| --- | --- |
| Unauthenticated access to the corpus | Fail-closed bearer auth; no token → no endpoint |
| Over-privileged tokens (read key that can also delete) | Per-token least-privilege scopes; write/admin gated separately |
| A leaked/abandoned token living forever | Revocation + expiry, checked on every request (fail-closed) |
| Cross-tenant data bleed | Postgres RLS scopes every query to the token's tenant |
| Malformed / injected tool arguments | Zod schema validation before any handler runs |
| Fabricated or unsupported answers | Citation-enforced synthesis + faithfulness check (`kl_ask_global`) |
| Data exfiltration via a third-party embedding API | Local embeddings (bge-m3); corpus stays in your Postgres |
| Timing attacks on the static key | Constant-time comparison |

## Authentication — fail-closed, two forms

The MCP fetch handler is wrapped so the endpoint **requires** a valid bearer with the
`knowledge:read` scope; anything else is rejected (`apps/server/src/mcp.ts`). Two bearer
forms are accepted:

1. **Static `MCP_API_KEY`** — one shared key for simple single-tenant deployments. No
   minting, no DB row. Compared in **constant time** (`node:crypto` `timingSafeEqual`).
   It is the trusted key, so it grants all scopes — use minted tokens when you want
   least-privilege.
2. **Per-token `typ="mcp"` JWT** (HS256 over `AUTH_SECRET`) — minted with
   `scripts/issue-mcp-token.ts`. The JWT is verified **and** its `jti` is checked in the
   `mcp_tokens` registry. The check **fails closed**: an unknown, revoked, or expired
   `jti` is treated as inactive → request rejected.

There is no anonymous path and no admin UI to misconfigure — the server is headless.

## Authorization — least-privilege scopes

Tokens carry explicit scopes. The endpoint gate is `knowledge:read`; elevated tools
enforce their own scope inside the tool. Mint a token with only the scopes an agent needs.

| Tool | Scope required | Risk class |
| --- | --- | --- |
| `kl_search`, `kl_ask_global`, `kl_get_material`, `kl_graph_neighbors` | `knowledge:read` | read |
| `mem_recall` | `memory:read` | read |
| `kl_ingest` | `knowledge:write` | write |
| `mem_write` | `memory:write` | write |
| `kl_signal` | `knowledge:signal` | feedback |
| `kl_forget` | `knowledge:admin` | destructive |
| `mem_forget` | `memory:admin` | destructive |

Give a retrieval-only agent a `knowledge:read` token and it physically cannot ingest,
delete, or write memory — the capability is absent from the token, not hidden behind a
prompt.

## Tenant isolation — enforced below the application

Every tool runs inside `withTenant(...)`, which opens a transaction with the
`app.current_tenant` GUC set from the **verified token's** tenant. Postgres **row-level
security** then scopes every read and write — including the answer cache — to that tenant
(`apps/server/src/mcp.ts`, migration `drizzle/0003_tenant_isolation.sql`). The tenant
comes from the token, never from a tool argument, so an agent cannot ask for another
tenant's data. Single-tenant deployments carry the default tenant and configure nothing.

> Multi-tenant enforcement requires the app to connect as a **non-superuser** database
> role, because superusers bypass RLS.

## Input & output guardrails

- **Input:** every tool `safeParse`s its arguments against a Zod schema before the handler
  runs. Invalid arguments return an error and never reach the engine.
- **Output:** `kl_ask_global` is citation-enforced (no source, no claim), refuses the
  unsupported parts of a question, and runs a faithfulness check; guard events are logged
  (`packages/shared/src/lib/knowledge/guard.ts`, `faithfulness.ts`). See the
  [why-trace deep-dive](./blog/why-trace.md).

## Data residency

- **Self-hosted.** You run the instance; the corpus lives in your Postgres. Nothing is
  sent to a SaaS to be stored or indexed.
- **Local embeddings.** Retrieval embeddings (bge-m3) run locally and need no cloud key,
  so ingested text is not shipped to an embedding provider. Only the optional *synthesis*
  step calls your configured chat model.
- **Managed Postgres / TLS.** For managed Postgres that requires SSL, set
  `DATABASE_SSL=true`.

## Supply chain

- Conventional Commits + commitlint + CI (typecheck, tests, lint) gate every change.
- Container images are built and published to GHCR on each release (multi-arch),
  **cosign-signed (keyless / Sigstore) with an SBOM + SLSA build-provenance** attestation.
- Dependency hygiene: GitHub Actions are watched by Dependabot. (Bun dependency updates
  are best handled by Renovate — see `.github/dependabot.yml`.)

## Alignment with the Agentic Product Standard (v2.0, Layer 8)

AgenticMind is the reference implementation of the
[Agentic Product Standard](https://github.com/Moai-Team-LLC/agentic-product-standard),
whose v2.0 makes security a first-class layer. This section records the two analyses that
layer asks every product to make explicit.

### Lethal-trifecta analysis

The "lethal trifecta" is the dangerous combination of **access to private data**,
**exposure to untrusted content**, and **the ability to exfiltrate**. All three are
reachable here:

- **Private data** — the corpus and memory you ingest.
- **Untrusted content** — `kl_ingest` accepts arbitrary text; retrieved passages are, by
  definition, attacker-influenceable.
- **Egress** — synthesis sends retrieved context to your configured chat model.

**Which leg is broken:** the exfiltration leg is structurally constrained. The model
receives only **retrieved, citation-gated** context; its answer is **faithfulness-checked**
and citation-enforced; and the server exposes **data, not actions** — there is **no
outbound tool surface** the model can drive (no web fetch, no email, no shell), and the
only egress is the single configured synthesis endpoint with no model-chosen destination. A
manipulated prompt cannot make AgenticMind *do* anything beyond returning text to the caller.

### Indirect prompt injection

Direct injection in the *question* is caught by `guardInput` (fail-closed, EN+RU markers)
and is a first-class eval mode. **Indirect** injection — a poisoned *ingested* document
steering a later answer — is mitigated by citation-enforcement (an injected instruction is
not a cited source) and the faithfulness check, but treat **all ingested content as
untrusted** and scope write/ingest tokens accordingly. A dedicated poisoned-corpus red-team
pass (against the standard's `templates/security/` kit) is on the roadmap.

### Identity & OAuth posture

Identity and tenant are derived from the **verified token, never the model**, and row-level
security enforces isolation below the application (see *Tenant isolation* above). Tokens are
scoped, short-lived (JWT `exp`), and revocable. Full **OAuth 2.1 + external IdP**
(audience-bound, no over-scoping) is an enterprise-edition item; the static `MCP_API_KEY` is
an all-scope key for trusted single-tenant use, so prefer minted scoped tokens for least
privilege.

## Honest limits (not yet in the open core)

These belong to a future enterprise edition, not the Apache-2.0 core:

- SSO / SAML / SCIM and an external IdP.
- Org-level RBAC beyond per-token scopes.
- Signed releases / SBOM attestation, formal SOC 2.

If your deployment needs these today, treat scoped tokens + RLS + network controls as the
current boundary and keep the instance inside your own perimeter.

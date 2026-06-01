# Security Policy

AgenticMind is security-sensitive infrastructure: it brokers an agent's access to
a knowledge base over MCP, mints scoped bearer tokens, and runs guardrails on the
input and output of every call. We take reports seriously.

## Supported versions

The latest released minor version receives security fixes. AgenticMind is pre-1.0;
pin a version and upgrade deliberately.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | ✅        |
| < 0.2   | ❌        |

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Use GitHub's [private vulnerability reporting](https://github.com/Moai-Team-LLC/AgenticMind/security/advisories/new)
(Security → Report a vulnerability). Include:

- a description and the impact,
- steps to reproduce (a minimal PoC if possible),
- affected version / commit.

We aim to acknowledge within **72 hours** and to ship a fix or mitigation for
confirmed high-severity issues promptly. We'll credit reporters who want it.

## Scope & hardening notes

In scope: the MCP auth path (JWT verification, token scopes, fail-closed
behavior), the input/output guardrails (injection, PII), SSRF on URL ingestion,
SQL/template injection, and secret handling.

Out of scope: issues that require a pre-compromised host, a malicious operator
with valid `knowledge:write`/admin scopes, or third-party model-provider
behavior. Self-hosters are responsible for their database, network, and the
secrets in their `.env`.

# Safe by construction: what the agent-extension security scans should change

> A deep-dive on AgenticMind's security posture, in the context of the 2026 wave of
> insecure agent extensions. Companion to [the AgenticMind repo](https://github.com/Moai-Team-LLC/AgenticMind).

> **Author note before publishing.** The Snyk figures below are attributed to Snyk's
> *ToxicSkills* report (5 Feb 2026). Re-verify the numbers and date at publish time — this
> space moves fast. The argument stands on AgenticMind's design either way; it does not
> depend on any single stat.

## The uncomfortable baseline

As agents got the ability to load skills and call MCP servers, the security of that
ecosystem became the security of your agent. The early data is not reassuring. Snyk's
*ToxicSkills* scan of 3,984 agent skills reported that **13.4% had at least one critical
vulnerability**, **36.8% carried at least one security flag**, and dozens of confirmed
malicious payloads were found in the wild. OWASP responded with an *Agentic Skills Top 10*.

The lesson isn't "extensions are bad." It's that an agent extension is **production
software with production access**, and most of the ecosystem is shipping it like a weekend
script — broad permissions, no isolation, no audit trail.

AgenticMind is an MCP *server*, not a skill, so it wasn't in that particular scan. But it
sits in the same trust position: an agent points at it and acts on what it returns. So the
right question is not "did we pass a scan" — it's **"what failure modes does the design
make impossible?"** Here are the ones the scans keep surfacing, and how AgenticMind closes
each by construction.

## Failure mode 1: over-broad permissions

The common pattern is one credential that can do everything. A retrieval helper ends up
able to delete or exfiltrate because the token isn't scoped.

AgenticMind tokens are **least-privilege and explicit**. The endpoint requires
`knowledge:read`; ingest needs `knowledge:write`, deletion needs `knowledge:admin`, memory
writes need `memory:write`, and so on. Mint a token with only `knowledge:read` and the
agent *physically cannot* ingest or delete — the capability is absent from the token, not
hidden behind a prompt instruction it might ignore.

## Failure mode 2: credentials that never die

A leaked or abandoned key that works forever is the gift that keeps giving to an attacker.

AgenticMind tokens are **revocable and expiring**, and validity is re-checked on **every**
request against a registry. The check **fails closed**: unknown, revoked, or expired →
rejected. The static key path is compared in constant time to avoid leaking it through
timing. There is no anonymous fallback and no admin UI to misconfigure into an open state.

## Failure mode 3: data bleed across tenants

Multi-tenant agent infra that scopes data in application code leaks the moment one query
forgets the `WHERE tenant_id = ?`.

AgenticMind enforces isolation **below** the application: every tool runs inside a Postgres
row-level-security context whose tenant comes from the verified token (never from a tool
argument). RLS scopes every read, write, and even the answer cache. An agent cannot ask
for another tenant's data because the tenant isn't a parameter it controls.

## Failure mode 4: the model just makes it up

The subtler risk is not a CVE — it's an answer that looks right, cites nothing, and gets
pasted into a decision. The Ctrl-C / Ctrl-V hazard.

AgenticMind's synthesis is **citation-enforced**: no source, no claim. It refuses the parts
of a question the corpus can't support instead of fabricating them, runs a faithfulness
check, and emits a replayable [why-trace](./why-trace.md) so you can audit exactly what was
retrieved and used. Safety here means *you can prove why an answer exists* — which is also
what regulators (EU AI Act) are starting to require.

## Failure mode 5: your corpus quietly leaves the building

Many memory SDKs ship your text to a third-party embedding API. That's a data-exfiltration
surface you didn't choose.

AgenticMind is **self-hosted** and runs **embeddings locally** (bge-m3, zero-key). Ingested
text stays in your Postgres; only the optional synthesis step calls your configured chat
model. The corpus is yours, in your perimeter.

## What "safe by construction" actually buys

None of the above is a feature you enable. It's the shape of the system: fail-closed auth,
scoped tokens, RLS, schema-validated inputs, citation-enforced outputs, local embeddings.
The full model is documented in [`docs/security-model.md`](../security-model.md).

The takeaway for anyone choosing agent infrastructure in 2026: stop asking "what can it
do" and start asking "what can it *not* do, even if the agent is compromised or wrong." A
good answer to that second question is the whole product.

## Try it

Apache-2.0, self-hostable on Postgres alone:

```bash
OPENAI_API_KEY=sk-... sh -c "$(curl -fsSL https://raw.githubusercontent.com/Moai-Team-LLC/AgenticMind/main/quickstart.sh)"
```

---

*AgenticMind is the reference implementation of the [Agentic Product Standard](https://github.com/Moai-Team-LLC/agentic-product-standard).*

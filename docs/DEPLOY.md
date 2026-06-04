# Deploy AgenticMind

Run AgenticMind in production from the published GHCR images — **no clone, no
build, one OpenAI key, one shared MCP key.**

Images: `ghcr.io/moai-team-llc/agenticmind-server` and `…-worker`, tagged per
release (`:latest`, `:0.5`, `:0.5.0`). Requires Docker Compose **v2.23+**.

## A. Standalone stack

```bash
cd deploy
./gen-secrets.sh            # generates AGENTICMIND_DB_PASSWORD + MCP_API_KEY into .env
#  then set OPENAI_API_KEY in deploy/.env
docker compose up -d
```

The stack ([`deploy/docker-compose.yml`](../deploy/docker-compose.yml)):

| Service | Role |
| --- | --- |
| `agenticmind-db` | Postgres 17 + pgvector/pgvectorscale (extensions auto-created) |
| `agenticmind-migrate` | applies Drizzle migrations once, then exits |
| `agenticmind-server` | the MCP endpoint on `http://localhost:3000/mcp` |
| `agenticmind-worker` | the daily compounding sweep |

Point your app at the MCP endpoint:

```
POST http://localhost:3000/mcp
Authorization: Bearer <MCP_API_KEY>
```

## B. Embed in your own compose

Copy the `agenticmind-*` services plus the `configs:` and `volumes:` blocks from
`deploy/docker-compose.yml` into your stack, and add the three secrets to your
own `.env`. Your app's container then reaches the server at
`http://agenticmind-server:3000/mcp`.

## Auth — one shared key, no minting

`MCP_API_KEY` is the simple single-tenant auth: one long random bearer your app
sends. No `issue-token`, no `AUTH_SECRET`, no DB token row. It grants all scopes.
For least-privilege or multiple distinct clients, set `AUTH_SECRET` instead and
mint scoped JWTs with `issue-token` (see the README).

## LLM — reuse your OpenAI key

The compose points `CHAT_BASE_URL` at `api.openai.com/v1` with your
`OPENAI_API_KEY`; **no OpenRouter key is needed.** Embeddings run locally
(zero-key). Behind a blocked Hugging Face CDN, see
[`OPERATIONS.md`](OPERATIONS.md) § Switching model providers.

## Secrets

`./gen-secrets.sh` generates `AGENTICMIND_DB_PASSWORD` (random) and `MCP_API_KEY`
(random) into `deploy/.env` and is idempotent — re-running keeps existing values.
You never pick a database password by hand; the only secret you supply is the
OpenAI key you already have.

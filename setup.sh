#!/usr/bin/env bash
#
# AgenticMind local setup: install deps, start Postgres (pgvector), run migrations.
# Idempotent — safe to re-run. Requires Bun (>=1.3) and Docker.
#
#   cp .env.example .env.local   # set OPENROUTER_API_KEY + AUTH_SECRET first
#   ./setup.sh
#   bun run dev

set -euo pipefail

cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.local.yml)

echo "==> Checking prerequisites"
command -v bun >/dev/null 2>&1 || { echo "ERROR: Bun not found — install from https://bun.sh"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker not found — install Docker"; exit 1; }

if [ ! -f .env.local ]; then
  echo "==> No .env.local — copying from .env.example (remember to set OPENROUTER_API_KEY + AUTH_SECRET)"
  cp .env.example .env.local
fi

echo "==> Installing dependencies (bun install)"
bun install

echo "==> Starting Postgres + pgvector (host port 5435)"
"${COMPOSE[@]}" up -d

echo "==> Waiting for Postgres to accept connections"
for i in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    echo "    Postgres is ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: Postgres did not become ready in time"; exit 1
  fi
  sleep 1
done

echo "==> Running migrations"
bun run db:migrate-local

echo
echo "Setup complete. Next:"
echo "  bun run dev     # headless MCP server on :3000"
echo "  bun run check   # typecheck + tests"

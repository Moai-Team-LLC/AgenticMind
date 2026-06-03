#!/usr/bin/env bash
#
# AgenticMind local setup: install deps, start Postgres (pgvector), run migrations.
# Idempotent — safe to re-run. Requires Docker and a JS package manager (Bun or
# npm). The server and worker run on plain Node (>=22.18) or Bun.
#
#   cp .env.example .env.local   # set CHAT_API_KEY + AUTH_SECRET first
#   ./setup.sh
#   npm run dev                  # or: bun run dev
#
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.local.yml)

echo "==> Checking prerequisites"
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker not found — install Docker"; exit 1; }

# Pick a package manager: prefer Bun (its lockfile is canonical), else npm.
# Both handle the native postinstall builds (onnxruntime-node, sharp) out of the
# box — Bun via trustedDependencies, npm by running scripts; the repo ships an
# .npmrc with legacy-peer-deps so npm tolerates a couple of over-strict peers.
if command -v bun >/dev/null 2>&1; then
  PM=bun
elif command -v npm >/dev/null 2>&1; then
  PM=npm
else
  echo "ERROR: no package manager found — install Bun (https://bun.sh) or npm (Node >=22.18)"; exit 1
fi
echo "    Using package manager: $PM"

if [ ! -f .env.local ]; then
  echo "==> No .env.local — copying from .env.example (remember to set CHAT_API_KEY + AUTH_SECRET)"
  cp .env.example .env.local
fi

echo "==> Installing dependencies ($PM install)"
"$PM" install

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
"$PM" run db:migrate-local

echo
echo "Setup complete. Next:"
echo "  $PM run dev     # headless MCP server on :3000 (runs on Node or Bun)"
echo "  $PM run check   # typecheck + tests"

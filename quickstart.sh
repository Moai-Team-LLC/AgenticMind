#!/usr/bin/env sh
#
# AgenticMind quickstart — stand up the full stack from published images, no clone.
#
#   OPENAI_API_KEY=sk-... sh -c "$(curl -fsSL https://raw.githubusercontent.com/Moai-Team-LLC/AgenticMind/main/quickstart.sh)"
#
# What it does (idempotent — safe to re-run):
#   1. fetches the deploy/ drop-in (compose + env template + secret generator)
#   2. generates a DB password and a static MCP_API_KEY
#   3. wires in your OPENAI_API_KEY (reused for synthesis; embeddings run locally)
#   4. brings up Postgres + migrations + MCP server + worker
#   5. waits for health, then prints a ready-to-paste MCP client config
#
# Requirements: docker (Compose v2.23+), curl, openssl.
# Overrides via env: AGENTICMIND_REF (git ref, default main),
#                    AGENTICMIND_DIR (target dir, default ./agenticmind),
#                    AGENTICMIND_PORT (host port, default 3000).
set -eu

REF="${AGENTICMIND_REF:-main}"
DIR="${AGENTICMIND_DIR:-agenticmind}"
PORT="${AGENTICMIND_PORT:-3000}"
RAW="https://raw.githubusercontent.com/Moai-Team-LLC/AgenticMind/${REF}/deploy"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. preflight ────────────────────────────────────────────────────────────
command -v curl    >/dev/null 2>&1 || die "curl is required"
command -v openssl >/dev/null 2>&1 || die "openssl is required (used to generate secrets)"
command -v docker  >/dev/null 2>&1 || die "docker is required — install Docker Desktop or Engine"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (got none). Update Docker."

say "→ AgenticMind quickstart (ref: ${REF})"

# ── 2. fetch the deploy/ drop-in ────────────────────────────────────────────
mkdir -p "$DIR"
cd "$DIR"
say "→ fetching deploy files into $(pwd)"
curl -fsSL "$RAW/docker-compose.yml" -o docker-compose.yml || die "could not fetch docker-compose.yml"
curl -fsSL "$RAW/.env.example"        -o .env.example       || die "could not fetch .env.example"
curl -fsSL "$RAW/gen-secrets.sh"      -o gen-secrets.sh     || die "could not fetch gen-secrets.sh"
chmod +x gen-secrets.sh

# ── 3. secrets + OpenAI key ─────────────────────────────────────────────────
say "→ generating secrets (DB password + MCP_API_KEY)"
./gen-secrets.sh >/dev/null

# Inject OPENAI_API_KEY from the environment if provided (and not already set).
if [ "${OPENAI_API_KEY:-}" != "" ]; then
  if grep -qE '^OPENAI_API_KEY=.+' .env 2>/dev/null; then
    :  # already set in .env — keep it
  else
    # portable in-place edit (BSD + GNU sed)
    sed "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=${OPENAI_API_KEY}|" .env > .env.tmp && mv .env.tmp .env
  fi
fi

if ! grep -qE '^OPENAI_API_KEY=.+' .env 2>/dev/null; then
  warn ""
  warn "OPENAI_API_KEY is not set. The files are ready in ./${DIR}, but the stack"
  warn "needs a chat key for synthesis. Set it, then bring the stack up:"
  warn ""
  warn "  cd ${DIR}"
  warn "  echo 'OPENAI_API_KEY=sk-...' >> .env   # or edit .env"
  warn "  docker compose up -d"
  warn ""
  warn "(Re-running this script with OPENAI_API_KEY set will do it for you.)"
  exit 0
fi

# ── 4. bring it up ──────────────────────────────────────────────────────────
say "→ starting Postgres + migrations + MCP server + worker"
AGENTICMIND_PORT="$PORT" docker compose up -d

# ── 5. wait for health, then print the connection config ────────────────────
say "→ waiting for the MCP server to become healthy"
i=0
until curl -fsS "http://localhost:${PORT}/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 50 ]; then
    warn "server did not report healthy within ~150s."
    warn "check logs with:  cd ${DIR} && docker compose logs -f agenticmind-server"
    exit 1
  fi
  sleep 3
done

KEY="$(grep -E '^MCP_API_KEY=' .env | head -1 | cut -d= -f2-)"

say ""
say "✅ AgenticMind is up."
printf '\n'
printf '   MCP endpoint : http://localhost:%s/mcp\n' "$PORT"
printf '   Authorization: Bearer %s\n' "$KEY"
printf '\n'
say "Point an MCP client at it. Example (Claude Code / Cursor mcp config):"
cat <<JSON

  {
    "mcpServers": {
      "agenticmind": {
        "type": "http",
        "url": "http://localhost:${PORT}/mcp",
        "headers": { "Authorization": "Bearer ${KEY}" }
      }
    }
  }

JSON
say "Then ask your agent to call kl_ingest to add knowledge, and kl_ask_global to query it."
say "Manage the stack from ./${DIR}:  docker compose ps | logs -f | down"

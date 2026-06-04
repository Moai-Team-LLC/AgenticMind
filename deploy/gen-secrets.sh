#!/usr/bin/env bash
#
# Generate AgenticMind deploy secrets into deploy/.env. Idempotent: an existing
# value is kept, so it's safe to re-run. You only need to fill OPENAI_API_KEY.
#
#   ./gen-secrets.sh && docker compose up -d
#
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"

# Ensure KEY has a non-empty value in .env; if empty, set it to the output of CMD.
ensure() {
  local key="$1" cmd="$2"
  local cur
  cur=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [ -n "$cur" ]; then
    echo "  ${key} already set — kept"
    return
  fi
  local val
  val=$(eval "$cmd")
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
  echo "  generated ${key}"
}

command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required to generate secrets"; exit 1; }

ensure AGENTICMIND_DB_PASSWORD "openssl rand -hex 24"
ensure MCP_API_KEY "openssl rand -hex 32"

echo
if ! grep -qE "^OPENAI_API_KEY=.+" "$ENV_FILE"; then
  echo "⚠  Set OPENAI_API_KEY in deploy/.env — AgenticMind reuses it for synthesis."
fi
echo "Ready. Next:  docker compose up -d"
echo "Your MCP_API_KEY (for your app's Authorization: Bearer):"
grep -E "^MCP_API_KEY=" "$ENV_FILE" | cut -d= -f2-

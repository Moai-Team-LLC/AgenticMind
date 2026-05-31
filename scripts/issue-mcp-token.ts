/**
 * MCP token issuance CLI — mint a typ="mcp" bearer JWT and register its jti in
 * mcp_tokens so the fail-closed /mcp route accepts it. The headless server ships
 * no admin UI, so this is how a self-hoster mints the bearer their MCP client
 * (Claude Code/Desktop, Cursor, …) presents.
 *
 * Needs DATABASE_URL + AUTH_SECRET (the HS256 signing secret).
 *
 *   bun run scripts/issue-mcp-token.ts --label "claude-code" --ttl-days 365
 *   bun run scripts/issue-mcp-token.ts --scopes knowledge:read,knowledge:write,memory:read,memory:write
 *
 * Prints the bearer token to stdout (last line) — capture it, it is not stored
 * in plaintext anywhere.
 */

import { createHmac, randomUUID } from "node:crypto"

import { createClient } from "@agenticmind/shared/database/client"
import { issueMcpToken } from "@agenticmind/shared/database/query/knowledge/mcp-tokens"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"

/** base64url-encode (RFC 7515): standard base64 with +/→-_ and padding stripped. */
const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

/** Sign an HS256 JWT — no external dep so the CLI stays portable. */
const signHs256 = (payload: Record<string, unknown>, secret: string): string => {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = b64url(JSON.stringify(payload))
  const data = `${header}.${body}`
  const sig = b64url(createHmac("sha256", secret).update(data).digest())
  return `${data}.${sig}`
}

const argv = process.argv.slice(2)
const arg = (name: string): string | undefined => {
  const i = argv.indexOf("--" + name)
  return i >= 0 ? argv[i + 1] : undefined
}

const secret = process.env.AUTH_SECRET
if (secret === undefined || secret.length === 0) {
  console.error("AUTH_SECRET is unset — set it in .env.local before issuing a token")
  process.exit(2)
}

const label = arg("label") ?? "mcp-client"
const ttlDays = Number(arg("ttl-days") ?? "365")
const userUuid = arg("principal") ?? randomUUID()
const scopes = (arg("scopes") ?? "knowledge:read,knowledge:write,knowledge:signal,memory:read,memory:write")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

const jti = randomUUID()
const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
const nowSec = Math.floor(Date.now() / 1000)

const token = signHs256(
  {
    typ: "mcp",
    role: "knowledge_admin",
    sub: userUuid,
    jti,
    iat: nowSec,
    exp: Math.floor(expiresAt.getTime() / 1000),
  },
  secret,
)

const db = createClient(databaseSettings.DATABASE_URL)
const res = await issueMcpToken({ tx: db, jti, userUuid, label, expiresAt, scopes })
if (res.isErr()) {
  console.error("failed to register token:", res.error.message)
  process.exit(1)
}

console.error(
  `Issued token  jti=${jti}  principal=${userUuid}  scopes=[${scopes.join(", ")}]  expires=${expiresAt.toISOString()}`,
)
console.log(token)
process.exit(0)

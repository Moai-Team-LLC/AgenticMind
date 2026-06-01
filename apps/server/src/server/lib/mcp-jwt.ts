/**
 * MCP bearer-JWT mint + verify (HS256 over AUTH_SECRET). Tokens carry
 * typ="mcp" so they're distinguishable from session tokens; the jti is
 * registered in mcp_tokens for fail-closed revocation. Used by the admin
 * token-issuance tRPC procedures + the /api/mcp route's auth wrapper.
 */

import { mcpSettings } from "@agenticmind/shared/settings/mcp-settings"
import { jwtVerify, SignJWT } from "jose"
import { randomUUID } from "node:crypto"

const MCP_TOKEN_TYP = "mcp"

const secretKey = (): Uint8Array | null => {
  const secret = mcpSettings.AUTH_SECRET
  if (secret === undefined || secret.length === 0) {
    return null
  }
  return new TextEncoder().encode(secret)
}

export type MintedMcpToken = { token: string; jti: string; expiresAt: Date }

/** Mints an mcp-typ JWT for a user. Returns null when AUTH_SECRET is unset. */
export const mintMcpToken = async (props: {
  userUuid: string
  ttlDays: number
}): Promise<MintedMcpToken | null> => {
  const key = secretKey()
  if (key === null) {
    return null
  }
  const jti = randomUUID()
  const expiresAt = new Date(Date.now() + props.ttlDays * 24 * 60 * 60 * 1000)
  const token = await new SignJWT({ typ: MCP_TOKEN_TYP, role: "knowledge_admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(props.userUuid)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key)
  return { token, jti, expiresAt }
}

export type VerifiedMcpToken = { userUuid: string; jti: string }

/**
 * Verifies signature + typ + jti presence. Does NOT check revocation — the
 * caller does that against mcp_tokens (so the DB stays out of this pure-ish
 * crypto helper). Returns null on any failure.
 */
export const verifyMcpToken = async (bearer: string): Promise<VerifiedMcpToken | null> => {
  const key = secretKey()
  if (key === null) {
    return null
  }
  try {
    const { payload } = await jwtVerify(bearer, key, { algorithms: ["HS256"] })
    if (payload.typ !== MCP_TOKEN_TYP) {
      return null
    }
    const userUuid = typeof payload.sub === "string" ? payload.sub : ""
    const jti = typeof payload.jti === "string" ? payload.jti : ""
    if (userUuid === "" || jti === "") {
      return null
    }
    return { userUuid, jti }
  } catch {
    return null
  }
}

/** Whether MCP is configured at all (AUTH_SECRET present). */
export const isMcpConfigured = (): boolean => secretKey() !== null

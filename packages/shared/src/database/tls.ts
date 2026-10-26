/**
 * Database TLS — what the pool will actually do, and whether the profile allows it.
 *
 * node-postgres merges the parsed connection string OVER the pool options
 * (`Object.assign({}, config, parse(connectionString))`), so `sslmode` / `ssl`
 * in DATABASE_URL silently replace whatever `ssl` the code passes —
 * `?sslmode=no-verify` turns certificate verification off no matter what. The
 * effective setting is therefore computed with the same parser node-postgres
 * uses, and judged on that.
 *
 * - `standard`: unchanged. DATABASE_SSL=true still means TLS without certificate
 *   verification (now with a warning), unless DATABASE_SSL_CA is set, which opts
 *   into verification against that CA.
 * - `strict`: TLS, when on, must verify the server certificate (system CAs, or
 *   DATABASE_SSL_CA). An unverified effective setting is refused, and so is a
 *   DATABASE_URL that carries TLS parameters while DATABASE_SSL=true (the URL
 *   would silently override DATABASE_SSL_CA).
 */

import type { Profile } from "@agenticmind/shared/lib/profile"
import type { Result } from "neverthrow"
import type { ConnectionOptions } from "node:tls"

import { isStrict } from "@agenticmind/shared/lib/profile"
import { err, ok } from "neverthrow"
import { X509Certificate } from "node:crypto"
import { readFileSync } from "node:fs"
import { parse } from "pg-connection-string"

export type PoolSsl = false | ConnectionOptions

export type DatabaseTls = {
  /** What to pass as the pool's `ssl` option. */
  ssl: PoolSsl
  /** TLS on and the server certificate verified (after the URL override). */
  verified: boolean
  /** Set when TLS is on without verification (standard profile only). */
  warning?: string
}

export type DatabaseTlsInput = {
  profile: Profile
  /** DATABASE_SSL (raw "true"/"false" or the parsed boolean). */
  ssl: string | boolean | undefined
  /** DATABASE_SSL_CA: a PEM bundle, or a path to one. */
  ca: string | undefined
  databaseUrl: string
}

const CERT_BLOCK = /-----BEGIN CERTIFICATE-----\r?\n[\s\S]+?\r?\n-----END CERTIFICATE-----/gu

/**
 * Validates a PEM bundle: at least one certificate block, and every block parses
 * as an X.509 certificate. A value pasted into an env file with literal "\n"
 * escapes (common on hosting dashboards) is unescaped first.
 */
const ESCAPED_NEWLINE = String.raw`\n`

const validatePem = (raw: string, source: string): Result<string, string> => {
  const pem =
    !raw.includes("\n") && raw.includes(ESCAPED_NEWLINE)
      ? raw.replaceAll(ESCAPED_NEWLINE, "\n")
      : raw
  const blocks = pem.match(CERT_BLOCK) ?? []
  if (blocks.length === 0) {
    return err(`DATABASE_SSL_CA ${source} contains no PEM certificate`)
  }
  for (const block of blocks) {
    try {
      const certificate = new X509Certificate(block)
      if (certificate.raw.byteLength === 0) {
        return err(`DATABASE_SSL_CA ${source} contains an empty certificate`)
      }
    } catch (error) {
      return err(
        `DATABASE_SSL_CA ${source} contains a certificate that does not parse: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return ok(pem)
}

/** DATABASE_SSL_CA as validated PEM text: inline PEM, or else a path to a PEM file. */
export const loadCa = (raw: string | undefined): Result<string | null, string> => {
  if (raw === undefined || raw.trim() === "") {
    return ok(null)
  }
  if (raw.includes("-----BEGIN")) {
    return validatePem(raw, "value")
  }
  let text: string
  try {
    text = readFileSync(raw.trim(), "utf8")
  } catch (error) {
    return err(
      `DATABASE_SSL_CA file ${JSON.stringify(raw)} is not readable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return validatePem(text, `file ${JSON.stringify(raw)}`)
}

/**
 * The `ssl` value node-postgres ends up with: the URL's, if it sets one, else
 * ours — normalised the way pg's ConnectionParameters does (`ssl=true` → true,
 * `ssl=no-verify` → `{ rejectUnauthorized: false }`).
 */
const effectiveSsl = (configured: PoolSsl, urlSsl: unknown): unknown => {
  if (urlSsl === undefined) {
    return configured
  }
  if (urlSsl === "true") {
    return true
  }
  if (urlSsl === "no-verify") {
    return { rejectUnauthorized: false }
  }
  return urlSsl
}

const isVerified = (ssl: unknown): boolean => {
  if (ssl === false || ssl === undefined || ssl === null) {
    return false
  }
  if (ssl === true) {
    return true // Node TLS default: rejectUnauthorized = true
  }
  if (typeof ssl !== "object") {
    // An `ssl` string pg does not know: TLS on, verification unknown — fail closed.
    return false
  }
  return (ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized !== false
}

const isTlsOn = (ssl: unknown): boolean =>
  ssl !== false && ssl !== undefined && ssl !== null && ssl !== ""

const warned = new Set<string>()

/** Logs a TLS warning once per process (boot and the first pool both report it). */
export const warnDatabaseTlsOnce = (warning: string): void => {
  if (!warned.has(warning)) {
    warned.add(warning)
    console.warn(`[DATABASE] ${warning}`)
  }
}

/** Resolves the pool's TLS setting for a profile. Pure apart from reading a CA file. */
export const resolveDatabaseTls = (input: DatabaseTlsInput): Result<DatabaseTls, string> =>
  loadCa(input.ca).andThen((ca) => {
    const strict = isStrict(input.profile)
    // String() covers the SKIP_VALIDATION path, where DATABASE_SSL arrives raw.
    const sslOn = String(input.ssl) === "true"
    const configured: PoolSsl = !sslOn
      ? false
      : strict || ca !== null
        ? { rejectUnauthorized: true, ...(ca === null ? {} : { ca }) }
        : { rejectUnauthorized: false }

    let urlSsl: unknown
    try {
      urlSsl = (parse(input.databaseUrl) as { ssl?: unknown }).ssl
    } catch {
      urlSsl = undefined
    }
    const effective = effectiveSsl(configured, urlSsl)
    const tlsOn = isTlsOn(effective)
    const verified = tlsOn && isVerified(effective)

    if (strict) {
      if (sslOn && urlSsl !== undefined) {
        return err(
          "DATABASE_URL carries sslmode/ssl parameters while DATABASE_SSL=true; node-postgres lets the URL override DATABASE_SSL and DATABASE_SSL_CA — remove them from the URL",
        )
      }
      if (tlsOn && !verified) {
        return err(
          "the database connection uses TLS without verifying the server certificate (sslmode=no-verify, ssl=no-verify or equivalent)",
        )
      }
      return ok({ ssl: configured, verified })
    }

    return ok({
      ssl: configured,
      verified,
      ...(tlsOn && !verified
        ? {
            warning:
              "database TLS is on but the server certificate is NOT verified — set DATABASE_SSL_CA (or AGENTICMIND_PROFILE=strict) to verify it",
          }
        : {}),
    })
  })

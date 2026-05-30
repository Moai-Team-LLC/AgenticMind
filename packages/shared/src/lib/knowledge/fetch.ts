/**
 * SSRF-guarded URL fetcher — ported from services/knowledge/internal/fetch
 * (fetch.go). Downloads remote URLs for the http_url connector with defensive
 * limits: 30s timeout, 50 MiB cap, ≤5 redirects, and a private/loopback IP
 * guard re-checked after every redirect so an attacker can't bounce a public
 * URL onto an internal address.
 */

import { ResultAsync } from "neverthrow"
import { lookup } from "node:dns/promises"

export const MAX_BODY_BYTES = 50 * 1024 * 1024
export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_REDIRECTS = 5
const DEFAULT_USER_AGENT = "agenticmind-knowledge/1"

export type FetchResult = {
  /** Final URL after redirects. */
  url: string
  status: number
  contentType: string
  body: Uint8Array
}

export type FetchError = { readonly type: "fetch_error"; readonly message: string }

export type FetchConfig = {
  /** Disables the SSRF guard. ONLY for tests pointing at loopback. */
  allowPrivate?: boolean
  timeoutMs?: number
  userAgent?: string
  /** DI override for DNS resolution (tests). Returns IP strings. */
  resolveHost?: (host: string) => Promise<string[]>
}

const fetchError = (message: string): FetchError => ({ type: "fetch_error", message })

/** Reports whether an IP literal is loopback / private / link-local / CGNAT / etc. */
export const isPrivateIp = (ip: string): boolean => {
  const addr = ip.trim().toLowerCase()
  if (addr === "") return true

  // IPv4 (incl. IPv4-mapped IPv6 ::ffff:a.b.c.d)
  const v4 = addr.startsWith("::ffff:") ? addr.slice("::ffff:".length) : addr
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4)
  if (m !== null) {
    const o = m.slice(1, 5).map(Number)
    if (o.some((n) => n > 255)) return true // malformed → refuse
    const [a, b] = o as [number, number, number, number]
    if (a === 0) return true // unspecified / "this network"
    if (a === 127) return true // loopback
    if (a === 10) return true // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
    if (a === 192 && b === 168) return true // RFC1918
    if (a === 169 && b === 254) return true // link-local
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
    if (a >= 224) return true // multicast / reserved
    return false
  }

  // IPv6
  if (addr === "::" || addr === "::1") return true // unspecified / loopback
  if (
    addr.startsWith("fe80") ||
    addr.startsWith("fe9") ||
    addr.startsWith("fea") ||
    addr.startsWith("feb")
  )
    return true // link-local fe80::/10
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true // ULA fc00::/7
  if (addr.startsWith("ff")) return true // multicast ff00::/8
  return false
}

const resolveIps = async (host: string, config: FetchConfig): Promise<string[]> => {
  if (config.resolveHost !== undefined) return config.resolveHost(host)
  // Literal IPs resolve to themselves; otherwise resolve all A/AAAA records.
  const records = await lookup(host, { all: true })
  return records.map((r) => r.address)
}

const guardHost = async (host: string, config: FetchConfig): Promise<void> => {
  if (config.allowPrivate === true) return
  const ips = await resolveIps(host, config)
  if (ips.length === 0) throw new Error(`fetch: dns resolved no addresses for ${host}`)
  for (const ip of ips) {
    if (isPrivateIp(ip))
      throw new Error(`fetch: refusing private/loopback address ${ip} (host ${host})`)
  }
}

const sniffContentType = (body: Uint8Array): string => {
  const head = body.subarray(0, 5)
  const ascii = String.fromCharCode(...body.subarray(0, Math.min(64, body.length))).toLowerCase()
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)
    return "application/pdf" // %PDF
  if (head[0] === 0x50 && head[1] === 0x4b) return "application/zip" // PK.. (docx/xlsx)
  if (ascii.includes("<!doctype html") || ascii.includes("<html")) return "text/html"
  return "application/octet-stream"
}

const fetchOnce = async (url: string, config: FetchConfig): Promise<FetchResult> => {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const userAgent = config.userAgent ?? DEFAULT_USER_AGENT

  let current = url
  for (let redirects = 0; ; redirects++) {
    const parsed = new URL(current)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("fetch: only http and https are supported")
    }
    await guardHost(parsed.hostname, config)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.5",
        },
      })
    } finally {
      clearTimeout(timer)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (location === null) throw new Error("fetch: redirect without Location header")
      if (redirects >= MAX_REDIRECTS)
        throw new Error(`fetch: too many redirects (>${MAX_REDIRECTS})`)
      current = new URL(location, current).toString()
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`fetch: non-2xx status ${response.status}`)
    }

    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > MAX_BODY_BYTES) {
      throw new Error(`fetch: body exceeds ${MAX_BODY_BYTES} bytes`)
    }
    const headerType = response.headers.get("content-type")?.trim() ?? ""
    return {
      url: current,
      status: response.status,
      contentType: headerType !== "" ? headerType : sniffContentType(buffer),
      body: buffer,
    }
  }
}

/** Fetches a URL with the SSRF guard + limits. */
export const fetchUrl = (
  url: string,
  config: FetchConfig = {},
): ResultAsync<FetchResult, FetchError> =>
  ResultAsync.fromPromise(fetchOnce(url, config), (e) =>
    fetchError(e instanceof Error ? e.message : "fetch: unknown error"),
  )

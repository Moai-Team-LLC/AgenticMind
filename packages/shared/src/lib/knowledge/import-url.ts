/**
 * Pure URL → title/filename helpers for connector imports (env-free so they
 * unit-test without pulling the indexer's LLM client). Ported from
 * deriveTitle/deriveFilename in materials.go.
 */

/** Last meaningful path segment of a URL, falling back to host. */
export const deriveTitle = (u: string): string => {
  const scheme = u.indexOf("://")
  if (scheme < 0) return u
  let rest = u.slice(scheme + 3)
  const qh = rest.search(/[?#]/)
  if (qh >= 0) rest = rest.slice(0, qh)
  const parts = rest.split("/")
  for (let i = parts.length - 1; i > 0; i--) {
    const s = parts[i]!.trim()
    if (s !== "" && s !== "/") return s
  }
  return parts[0] ?? u
}

/** Stable blob basename from a URL + content type. */
export const deriveFilename = (u: string, mime: string): string => {
  let base = deriveTitle(u)
  const qh = base.search(/[?#]/)
  if (qh >= 0) base = base.slice(0, qh)
  if (base === "" || base === "/") {
    if (mime.includes("html")) return "page.html"
    if (mime.includes("pdf")) return "page.pdf"
    return "page.bin"
  }
  return base
}

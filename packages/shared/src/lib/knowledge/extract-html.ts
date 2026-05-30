/**
 * HTML → plain text extraction — ported from the extractHTML path in
 * services/knowledge/internal/extract/extract.go. Walks the DOM (htmlparser2),
 * prefers the first <article>/<main> subtree, drops boilerplate tags, inserts
 * paragraph breaks on block elements, then prunes short footer/CTA lines.
 */

import { parseDocument } from "htmlparser2"

type DomNode = {
  type: string
  name?: string
  data?: string
  children?: DomNode[]
}

const SKIP_TAGS = new Set([
  "script",
  "style",
  "head",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "noscript",
  "button",
  "svg",
  "iframe",
  "template",
  "dialog",
])

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "li",
  "tr",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
])

const BOILERPLATE_MARKERS = [
  "continue reading",
  "reader-supported publication",
  "subscribe to read",
  "subscribe now",
  "sign up for free",
  "sign in to read",
  "this site requires javascript",
  "enable javascript",
  "please enable javascript",
  "start your substack",
  "get the app",
  "all rights reserved",
  "privacy policy",
  "terms of service",
  "cookie policy",
  "· privacy",
  "previousnext",
  "upgrade to paid",
  "join the conversation",
  "share this post",
  "copy link",
  "facebook share",
  "twitter share",
]

const isElement = (n: DomNode): boolean =>
  n.type === "tag" || n.type === "script" || n.type === "style"
const tagName = (n: DomNode): string => (n.name ?? "").toLowerCase()
const isSkip = (n: DomNode): boolean =>
  n.type === "script" || n.type === "style" || (isElement(n) && SKIP_TAGS.has(tagName(n)))

const findFirstElement = (n: DomNode, tag: string): DomNode | null => {
  if (isElement(n) && SKIP_TAGS.has(tagName(n))) return null
  if (isElement(n) && tagName(n) === tag) return n
  for (const c of n.children ?? []) {
    const found = findFirstElement(c, tag)
    if (found !== null) return found
  }
  return null
}

const selectMainContent = (doc: DomNode): DomNode =>
  findFirstElement(doc, "article") ?? findFirstElement(doc, "main") ?? doc

const walk = (n: DomNode, out: string[], inSkip: boolean): void => {
  let skip = inSkip
  if (isSkip(n)) skip = true
  const block = isElement(n) && BLOCK_TAGS.has(tagName(n))
  if (!skip && block) out.push("\n")
  if (!skip && n.type === "text" && n.data !== undefined) out.push(n.data)
  for (const c of n.children ?? []) walk(c, out, skip)
  if (!skip && block) out.push("\n")
}

/** Collapses whitespace: space/tab runs → one space, ≥2 newlines → paragraph break. */
export const collapseWhitespace = (s: string): string => {
  let out = ""
  let prevSpace = true
  let prevNewlines = 2 // suppress leading blank lines
  for (const r of s) {
    if (r === "\n") {
      prevNewlines++
      if (prevNewlines === 2) out += "\n\n"
      prevSpace = true
    } else if (r === " " || r === "\t" || r === "\r") {
      if (!prevSpace) {
        out += " "
        prevSpace = true
      }
    } else {
      out += r
      prevSpace = false
      prevNewlines = 0
    }
  }
  return out.trim()
}

const isBoilerplateLine = (line: string): boolean => {
  const lower = line.toLowerCase()
  return BOILERPLATE_MARKERS.some((m) => lower.includes(m))
}

/** Drops short (<120 char) footer/CTA/boilerplate lines; keeps long content. */
export const prunePostExtractNoise = (s: string): string => {
  if (s === "") return s
  const kept = s.split("\n").filter((l) => {
    const trimmed = l.trim()
    if (trimmed === "") return true
    return !(trimmed.length < 120 && isBoilerplateLine(trimmed))
  })
  return collapseWhitespace(kept.join("\n"))
}

/** Extracts readable text from an HTML document. */
export const extractHtml = (html: string): string => {
  const doc = parseDocument(html) as unknown as DomNode
  const root = selectMainContent(doc)
  const out: string[] = []
  walk(root, out, false)
  return prunePostExtractNoise(collapseWhitespace(out.join("")))
}

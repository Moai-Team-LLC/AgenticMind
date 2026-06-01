import { describe, expect, it } from "vitest"

import { extractHtml } from "./extract-html"

describe("extractHtml", () => {
  it("extracts article text with paragraph breaks", () => {
    const out = extractHtml("<article><h1>Title</h1><p>Hello</p><p>World</p></article>")
    expect(out).toContain("Title")
    expect(out).toContain("Hello")
    expect(out).toContain("World")
  })

  it("prefers the <article> subtree and drops chrome", () => {
    const out = extractHtml(
      "<body><nav>Menu Home About</nav><article><p>Real body content here.</p></article><footer>© 2026</footer></body>",
    )
    expect(out).toContain("Real body content here.")
    expect(out).not.toContain("Menu Home")
    expect(out).not.toContain("2026")
  })

  it("drops script and style content", () => {
    const out = extractHtml(
      "<main><script>var x=1</script><style>.a{}</style><p>Visible</p></main>",
    )
    expect(out).toBe("Visible")
  })

  it("prunes short boilerplate lines but keeps long content", () => {
    const longLine = "This is a genuinely long paragraph of article content ".repeat(3)
    const out = extractHtml(`<article><p>${longLine}</p><p>Subscribe now</p></article>`)
    expect(out).toContain("genuinely long paragraph")
    expect(out).not.toContain("Subscribe now")
  })
})

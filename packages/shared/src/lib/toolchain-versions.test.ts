import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * One Bun version everywhere: the `packageManager` field (local installs), the
 * Docker base images (what production runs) and every CI `bun-version` (what
 * the gates test). Three lists of the same fact drift silently — 0.14.0 shipped
 * images on 1.3.11 while CI tested 1.3.12.
 */

const ROOT = new URL("../../../../", import.meta.url)
const read = (rel: string): string => readFileSync(new URL(rel, ROOT), "utf8")

const sources = (): { where: string; version: string }[] => {
  const found: { where: string; version: string }[] = []
  const pm = /^bun@(\S+)$/u.exec(
    (JSON.parse(read("package.json")) as { packageManager?: string }).packageManager ?? "",
  )
  if (pm?.[1] !== undefined) {
    found.push({ where: "package.json packageManager", version: pm[1] })
  }
  for (const file of ["Dockerfile.server", "Dockerfile.worker"]) {
    for (const m of read(file).matchAll(/^FROM oven\/bun:(\S+)/gmu)) {
      found.push({ where: file, version: m[1] ?? "" })
    }
  }
  for (const file of readdirSync(new URL(".github/workflows/", ROOT))) {
    for (const m of read(`.github/workflows/${file}`).matchAll(/bun-version:\s*(\S+)/gu)) {
      found.push({ where: `.github/workflows/${file}`, version: m[1] ?? "" })
    }
  }
  return found
}

describe("toolchain versions", () => {
  it("package.json, the Docker images and CI pin the same Bun", () => {
    const found = sources()
    const listing = found.map((f) => `${f.where}=${f.version}`).join(", ")
    // Control: every kind of source was actually read.
    expect(
      found.some((f) => f.where.startsWith("package.json")),
      listing,
    ).toBe(true)
    expect(
      found.some((f) => f.where.startsWith("Dockerfile")),
      listing,
    ).toBe(true)
    expect(
      found.some((f) => f.where.startsWith(".github")),
      listing,
    ).toBe(true)
    expect(new Set(found.map((f) => f.version)).size, listing).toBe(1)
  })
})

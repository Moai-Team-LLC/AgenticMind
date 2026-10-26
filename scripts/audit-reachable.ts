/**
 * Reachable-advisory gate. `bun audit` reports every advisory in the lockfile —
 * dev tools, the docs toolchain, the CLI-only file parsers — so its exit code is
 * red on a healthy service and stops meaning anything. This gate asks the
 * question that matters: is the vulnerable package in the import graph of a
 * service that runs (the MCP server, the worker)?
 *
 *   bun run audit:reachable
 *
 * It bundles each service entry point with a metafile (the static import graph,
 * dynamic imports included), runs `bun audit --json`, and intersects the two.
 * A reachable advisory fails the gate unless `scripts/audit-allowlist.json`
 * records why no input can reach the vulnerable code. Everything else is
 * reported as unreachable.
 *
 * Exit: 0 clean · 1 reachable advisory without a recorded reason · 2 could not
 * measure (a build or the audit failed, or the graph looks empty). 2 is never a
 * pass.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

type Advisory = { id: string; severity: string; title: string; url: string }
type AllowEntry = { id: string; package: string; reason: string }

const ROOT = resolve(import.meta.dirname, "..")
const SERVICES = [
  { name: "server", dir: "apps/server" },
  { name: "worker", dir: "apps/worker" },
]
// Packages each service must contain; their absence means the graph is wrong.
const CONTROLS: Record<string, string> = { server: "@modelcontextprotocol/sdk", worker: "pg" }

const fail = (code: 1 | 2, message: string): never => {
  console.error(`audit:reachable: ${message}`)
  process.exit(code)
}

const graphPackages = (service: { name: string; dir: string }, out: string): Set<string> => {
  const meta = join(out, `${service.name}.json`)
  const build = Bun.spawnSync(
    [
      "bun",
      "build",
      "src/index.ts",
      "--target=bun",
      `--outdir=${join(out, service.name)}`,
      `--metafile=${meta}`,
    ],
    { cwd: join(ROOT, service.dir), stdout: "pipe", stderr: "pipe" },
  )
  if (build.exitCode !== 0) {
    fail(2, `bundling ${service.name} failed:\n${build.stderr.toString()}`)
  }
  const inputs = Object.keys(
    (JSON.parse(readFileSync(meta, "utf8")) as { inputs?: Record<string, unknown> }).inputs ?? {},
  )
  const packages = new Set<string>()
  for (const input of inputs) {
    const names = [...input.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)\//gu)].map((m) => m[1])
    const last = names.at(-1)
    if (last !== undefined) {
      packages.add(last)
    }
  }
  return packages
}

const audit = (): Record<string, Advisory[]> => {
  const run = Bun.spawnSync(["bun", "audit", "--json"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
  try {
    return JSON.parse(run.stdout.toString()) as Record<string, Advisory[]>
  } catch {
    return fail(2, `bun audit produced no JSON (exit ${run.exitCode}):\n${run.stderr.toString()}`)
  }
}

const allowlist = JSON.parse(
  readFileSync(join(ROOT, "scripts/audit-allowlist.json"), "utf8"),
) as AllowEntry[]
const allowed = new Map(allowlist.map((e) => [e.id, e]))

const out = mkdtempSync(join(tmpdir(), "am-audit-"))
const graphs = new Map<string, Set<string>>()
try {
  for (const service of SERVICES) {
    const packages = graphPackages(service, out)
    const control = CONTROLS[service.name] ?? ""
    console.log(
      `${service.name}: ${packages.size} packages in the import graph (control ${control}: ${packages.has(control) ? "present" : "MISSING"})`,
    )
    if (packages.size === 0 || !packages.has(control)) {
      fail(2, `${service.name} import graph looks wrong — not measuring`)
    }
    graphs.set(service.name, packages)
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}

const advisories = audit()
const idOf = (a: Advisory): string => a.url.split("/").at(-1) ?? a.title
let reachable = 0
let accepted = 0
let unreachable = 0
const seen = new Set<string>()
for (const [pkg, list] of Object.entries(advisories)) {
  const services = [...graphs].filter(([, set]) => set.has(pkg)).map(([name]) => name)
  for (const a of list) {
    const id = idOf(a)
    seen.add(id)
    if (services.length === 0) {
      unreachable += 1
      continue
    }
    const where = `${pkg} [${services.join(", ")}] ${a.severity} ${id} — ${a.title}`
    const entry = allowed.get(id)
    if (entry !== undefined && entry.package === pkg) {
      accepted += 1
      console.log(`  accepted  ${where}\n            reason: ${entry.reason}`)
    } else {
      reachable += 1
      console.log(`  REACHABLE ${where}`)
    }
  }
}
for (const entry of allowlist) {
  if (!seen.has(entry.id)) {
    console.log(`  stale allowlist entry (no longer reported): ${entry.id} ${entry.package}`)
  }
}
console.log(
  `audit:reachable: ${reachable} reachable, ${accepted} accepted with a reason, ${unreachable} not in any service's import graph`,
)
if (reachable > 0) {
  fail(1, "reachable advisories without a recorded reason — upgrade, or record why no input reaches them")
}

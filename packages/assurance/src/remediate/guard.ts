/**
 * Cycle-of-Trust enforcer (FR-11.2 — hard invariant).
 *
 * Rejects any proposed remediation whose diff touches a side-effecting tool, a permission grant,
 * or a trust boundary. It inspects the concrete edit **paths**, never the declared `target`, so a
 * proposal cannot mislabel a permission change as a "prompt" edit to slip through. Fail-closed:
 * an edit that is neither clearly structural nor recognized is rejected.
 *
 * This is the highest-risk surface in AAL; the hard-gate test feeds it a permission-changing diff
 * and proves it is refused. Do not weaken these patterns to make a fix land.
 */
import type { FixProposal, GuardResult, GuardViolation, ProposedEdit } from "./proposal"

/**
 * Atomic path tokens that name a side-effecting tool / permission / trust boundary — always
 * forbidden. Matched as WHOLE tokens (not substrings), so `trusted` never trips `trust`.
 */
const FORBIDDEN_TOKENS = new Set<string>([
  "tool",
  "tools",
  "egress",
  "exec",
  "execution",
  "permission",
  "permissions",
  "scope",
  "scopes",
  "grant",
  "grants",
  "role",
  "roles",
  "acl",
  "identity",
  "credential",
  "credentials",
  "token",
  "tokens",
  "auth",
  "trust",
  "boundary",
  "allowlist",
  "allowlists",
  "hook",
  "hooks",
  "settings",
])

/** Compound forbidden terms that camelCase/underscore splitting would break apart — caught on the
 * separator-stripped join so `sideEffect` / `code_exec` / `apiKey` cannot slip through. */
const FORBIDDEN_COMPOUNDS = ["sideeffect", "codeexec", "apikey"]

/** Root tokens that ARE structural configuration — the only surfaces an edit may start from. */
const ALLOWED_ROOTS = new Set<string>([
  "prompt",
  "context",
  "manifest",
  "few",
  "fewshot",
  "system",
  "systemprompt",
  "declared",
])

/**
 * Split a logical edit path into atomic lowercase tokens: separators (`. _ - / [ ]`) AND camelCase
 * boundaries both split, so a glued segment like `allowedTools` becomes `allowed` + `tools` and the
 * forbidden token is exposed. This is what the old `\b`-boundary regexes missed.
 */
function tokenize(path: string): string[] {
  return path
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

function checkEdit(edit: ProposedEdit): GuardViolation | null {
  const tokens = tokenize(edit.path)
  const root = tokens[0]
  if (root === undefined) {
    return { path: edit.path, reason: "empty / unparseable edit path (fail-closed)" }
  }
  for (const token of tokens) {
    if (FORBIDDEN_TOKENS.has(token)) {
      return {
        path: edit.path,
        reason: `touches a forbidden surface (\`${token}\`): a tool, permission, or trust boundary`,
      }
    }
  }
  const collapsed = tokens.join("")
  for (const compound of FORBIDDEN_COMPOUNDS) {
    if (collapsed.includes(compound)) {
      return { path: edit.path, reason: `touches a forbidden surface (\`${compound}\`)` }
    }
  }
  if (!ALLOWED_ROOTS.has(root)) {
    return {
      path: edit.path,
      reason: `root \`${root}\` is not a recognized structural-config surface (fail-closed)`,
    }
  }
  return null
}

/**
 * Enforce the Cycle of Trust on a proposal. Allowed only if EVERY edit is a structural-config
 * surface and NONE touches a tool / permission / trust boundary.
 */
export function enforceCycleOfTrust(proposal: FixProposal): GuardResult {
  const violations: GuardViolation[] = []
  for (const edit of proposal.edits) {
    const v = checkEdit(edit)
    if (v) violations.push(v)
  }
  return { allowed: violations.length === 0, violations }
}

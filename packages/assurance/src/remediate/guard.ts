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

/** Paths that touch a side-effecting tool / permission / trust boundary — always forbidden. */
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\btools?\b/,
    reason: "touches a tool definition (side-effecting tools are out of bounds)",
  },
  { pattern: /\bside[-_]?effect\b/, reason: "touches a tool's side-effect class" },
  { pattern: /\begress\b/, reason: "touches an egress capability" },
  { pattern: /\bexec(ution)?\b|\bcode[-_]?exec\b/, reason: "touches a code-execution capability" },
  {
    pattern: /\bpermission|\bscopes?\b|\bgrant\b|\brole\b|\bacl\b/,
    reason: "touches a permission grant",
  },
  {
    pattern: /\bidentity\b|\bcredential\b|\btoken\b|\bapi[-_]?key\b|\bauth\b/,
    reason: "touches identity / credentials",
  },
  { pattern: /\btrust\b|\bboundary\b|\ballow[-_]?list\b/, reason: "touches a trust boundary" },
  {
    pattern: /\bhook\b|\bsettings\b|\bconfig\.(mcp|server|db)/,
    reason: "touches runtime configuration / hooks",
  },
]

/** Path prefixes that ARE structural configuration — the only edits allowed. */
const ALLOWED_STRUCTURAL: RegExp[] = [
  /^prompt\b/,
  /^context\b/,
  /^few[-_]?shot/,
  /^manifest\.declaredmitigations\b/,
  /^declaredmitigation/,
  /^system[-_]?prompt\b/,
]

function checkEdit(edit: ProposedEdit): GuardViolation | null {
  const path = edit.path.trim().toLowerCase()
  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(path)) return { path: edit.path, reason }
  }
  if (!ALLOWED_STRUCTURAL.some((p) => p.test(path))) {
    return { path: edit.path, reason: "not a recognized structural-config surface (fail-closed)" }
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

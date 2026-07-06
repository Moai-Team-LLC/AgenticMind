/**
 * AAL Evidence — compliance & evidence layer over AAL Core.
 *
 * Consumes AAL Core's structured findings, maps target facts to a control catalog
 * (AIUC-1 / OWASP ASI / ISO 42001), harvests evidence from AgenticMind's existing artifacts,
 * scores every control Green/Yellow/Red, and emits a continuously-refreshable auditor bundle.
 *
 * Staging note: this package is destined for `AgenticMind/packages/assurance` (@agenticmind/assurance).
 * Its scoring/catalog/bundle logic is framework-neutral and runs standalone; the native collectors
 * take engine rows as input so the mapping is tested here and only the Drizzle query is wired in-repo.
 */
export const AAL_EVIDENCE_VERSION = "0.1.0" as const

export * from "./catalog"
export * from "./evidence"
export * from "./gap"
export * from "./bundle"
export * from "./remediate"

# AAL Control Catalog

The crosswalk that AAL Evidence (`packages/assurance`) scores against. It maps a set of
stable AAL control IDs to three external frameworks and to the concrete AgenticMind artifact
that proves each one.

## What each control carries

- **`aiuc1_domain`** — one of the six AIUC-1 domains (A Data & Privacy, B Security, C Safety,
  D Reliability, E Accountability, F Society).
- **`owasp_asi`** — one or more OWASP Top 10 for Agentic Applications 2026 ids (ASI01–ASI10).
- **`iso42001`** — the ISO/IEC 42001 Annex A control area, by theme.
- **`evidence_requirement`** — the artifact that satisfies it, and the `collector`
  (`native` = auto-read from the engine, `generic` = OTel/manual for other agents,
  `manual` = human-produced/documentation).
- **`test_requirement`** — which AAL Core (Plane A) attack class validates it, if any.
- **`status_rule`** — the Green/Yellow/Red contract the gap engine enforces.

## The scoring contract (read before trusting a Green)

1. A **failing Plane-A test forces RED**, no matter what mitigation is declared.
2. **No collected evidence ⇒ YELLOW** at best (`not_verified`), never Green.
3. **GREEN requires evidence AND**, where a test is required, **a passing test.**

This is why the catalog is only useful next to AAL Core (it supplies the tests) and a live
AgenticMind instance (it supplies the native evidence).

## Honesty caveats (do not remove)

- **AIUC-1 requirement IDs are not public**, and the standard **refreshes quarterly**
  (~49 requirements / 130 controls after the Q1-2026 update). Every row is mapped at the
  **domain level** and flagged `aiuc1_confirm: true` — verify the exact requirement/control
  numbers against the **current AIUC-1 release** before using this for a real audit.
- ISO 42001 rows reference Annex A **areas by theme** (`iso_confirm: true`), not exact clause
  numbers.
- Rows marked `collector: manual` (much of Safety and Society, some Reliability) are
  **judgment-based / documentation-satisfiable** and cannot be auto-scored Green from engine
  telemetry — they need human evidence.

## Recommended v1.0 scope

Per `AAL_Requirements_v0.1.md` §11, start with the two domains where native evidence is
strongest — **B (Security)** and **E (Accountability)** — the rows marked `scope: core`.
Everything else is `scope: expand`; the gap engine can filter on this without deleting rows.

## Keeping it current

Treat the catalog as living data, versioned independently of code. When AIUC-1 or the OWASP
list updates, bump `version`, edit rows, and record the change via Conventional Commits — do
not hard-code control assumptions in the engine.

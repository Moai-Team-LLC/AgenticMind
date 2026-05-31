// oxlint-disable node/no-process-env
/**
 * Test-only side effect: unit tests must not require real provider keys. Set
 * SKIP_VALIDATION before any settings module (`@t3-oss/env-core`) is imported,
 * so importing the MCP surface in a test doesn't throw on missing env. Import
 * this FIRST, before any module that transitively pulls in settings.
 */
process.env.SKIP_VALIDATION = process.env.SKIP_VALIDATION ?? "true"

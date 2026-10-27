/**
 * Tenant isolation — the single source of truth for the `tenant_id` column spread
 * into every tenant-scoped table, plus the default-tenant sentinel.
 *
 * Opt-in model: a single-tenant deployment sets nothing and every row carries the
 * DEFAULT_TENANT_ID (the column DEFAULT resolves the unset GUC to it), so the
 * product works with zero configuration. A multi-tenant deployment sets the
 * `app.current_tenant` GUC per request (see `withTenant` in database/client.ts),
 * and row-level-security policies — added in the tenant-isolation migration —
 * enforce isolation on every read AND write, below the application and the LLM.
 */

import { sql } from "drizzle-orm"
import { uuid } from "drizzle-orm/pg-core"

/** Sentinel tenant used when no `app.current_tenant` is set (single-tenant). */
export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000"

/**
 * The DB DEFAULT auto-stamps the active tenant from the `app.current_tenant` GUC,
 * falling back to the default tenant when it is unset — so inserts never have to
 * pass `tenant_id` and single-tenant just works.
 */
/**
 * The tenant of the current transaction (the `app.current_tenant` GUC that
 * withTenant sets; the default tenant when unset). Row-level security applies
 * it for the app role, but a superuser or table owner bypasses RLS — so a
 * lookup by a key that is unique only per tenant (an idempotency key, an
 * external identity) states the tenant explicitly too.
 */
export const currentTenantId = sql`coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid`

export const tenantColumn = {
  tenantId: uuid("tenant_id")
    .notNull()
    .default(
      sql`coalesce(current_setting('app.current_tenant', true), '00000000-0000-0000-0000-000000000000')::uuid`,
    ),
}

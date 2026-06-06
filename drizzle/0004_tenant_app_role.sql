-- Least-privilege runtime role for multi-tenant Row-Level-Security enforcement.
--
-- Superusers and BYPASSRLS table owners skip RLS, so running the application as
-- the bootstrap/superuser role silently disables tenant isolation. This
-- migration provisions a NOLOGIN, NOBYPASSRLS, non-superuser role. In
-- multi-tenant deployments set DATABASE_APP_ROLE to its name; withTenant() then
-- issues `SET LOCAL ROLE` per transaction, downgrading the (possibly superuser)
-- connection so the tenant_isolation policy from 0003 applies.
--
-- NOLOGIN: the role is never connected to directly — it is only reached via
-- SET ROLE from the migrating/owning login role. No password, no secret.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agenticmind_app') THEN
    CREATE ROLE "agenticmind_app" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO "agenticmind_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "agenticmind_app";
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "agenticmind_app";
--> statement-breakpoint
-- Tables/sequences created by later migrations (run by the same migrating role)
-- inherit these grants automatically, so future migrations need no extra GRANT.
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "agenticmind_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT USAGE, SELECT ON SEQUENCES TO "agenticmind_app";

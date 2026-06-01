-- Runs once on first DB init (mounted into /docker-entrypoint-initdb.d).
-- The schema needs three extensions before migrations run:
--   vector       — vector(1536) columns
--   vectorscale  — `USING diskann` ANN indexes (depends on vector, so order matters)
--   pg_trgm      — `gin_trgm_ops` trigram index for fuzzy text lookup
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS vectorscale;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

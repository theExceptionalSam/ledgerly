-- Account lockout columns for users + parents.
--
-- Context: src/controllers/auth.controller.js ALREADY implements 5-attempt
-- lockout (15-minute window) for staff logins using the `failed_login_count`
-- + `locked_until` columns on `users` (added in schema.sql). The parent portal
-- login (src/controllers/parents.controller.js) has NO lockout — this migration
-- adds the same columns to `parents` so the parent login can be hardened the
-- same way.
--
-- This migration also renames `users.failed_login_count` → `failed_login_attempts`
-- to align with the task spec's naming and to be consistent with the new
-- `parents.failed_login_attempts` column. The rename is conditional (DO block)
-- so it is safe on:
--   * fresh DBs — schema.sql already uses `failed_login_attempts`, so the
--     rename is skipped (column not found under the old name);
--   * existing DBs — the column is still `failed_login_count`, so it is renamed.
-- `ALTER TABLE ... RENAME COLUMN` is a metadata-only operation in Postgres
-- (instant, no table rewrite), so this is safe on large tables.
--
-- `users.locked_until` already exists as TEXT (schema.sql line 24). The
-- `ADD COLUMN IF NOT EXISTS` below is a no-op for users — the column keeps its
-- TEXT type. auth.controller.js handles both TEXT and TIMESTAMPTZ via
-- `new Date(value)`. For `parents`, `locked_until` is new and is created as
-- TIMESTAMPTZ (the proper type).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'failed_login_count'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'failed_login_attempts'
  ) THEN
    ALTER TABLE users RENAME COLUMN failed_login_count TO failed_login_attempts;
  END IF;
END $$;

-- Ensure both columns exist on users (no-op if already present after the rename
-- above; `failed_login_attempts` is added fresh if the rename was skipped on a
-- partially-migrated DB).
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Add both columns to parents (both new).
ALTER TABLE parents ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE parents ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Academic Sessions: a session (e.g. "2025/2026") groups terms
-- (1st Term, 2nd Term, 3rd Term). Terms now belong to a session.

CREATE TABLE IF NOT EXISTS academic_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON academic_sessions(tenant_id);

-- Add session_id to terms (nullable for backward compat with pre-existing terms).
ALTER TABLE terms ADD COLUMN session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL;

-- Backfill: every tenant gets one default session, and all existing terms
-- are linked to it. This preserves the current term-switching behaviour.
INSERT INTO academic_sessions (id, tenant_id, name, is_current)
SELECT gen_random_uuid()::text, id, 'First Session', 1 FROM tenants;

UPDATE terms
SET session_id = (SELECT id FROM academic_sessions WHERE tenant_id = terms.tenant_id AND is_current = 1 LIMIT 1)
WHERE session_id IS NULL;

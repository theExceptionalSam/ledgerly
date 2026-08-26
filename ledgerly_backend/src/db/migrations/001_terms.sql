-- Phase 1: Academic terms (session/term model).
-- Everything else in the v2 upgrade is scoped by term, so this ships first.

CREATE TABLE IF NOT EXISTS terms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terms_tenant ON terms(tenant_id);

-- Backfill: every existing tenant gets one term named after their current
-- tenants.term value, marked current, so existing data has somewhere to attach.
INSERT INTO terms (id, tenant_id, name, is_current)
SELECT gen_random_uuid()::text, id, term, 1 FROM tenants;

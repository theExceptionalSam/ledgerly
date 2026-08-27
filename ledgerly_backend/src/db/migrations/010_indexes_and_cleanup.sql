-- Performance indexes + cleanup.
-- Adds missing indexes identified in the CTO review, and drops the vestigial
-- tenants.term column (superseded by the terms table in migration 001).

-- Index for refresh-token lookups (auth.controller.js refresh endpoint)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- Index for term-scoped payment queries (dashboard, students list)
CREATE INDEX IF NOT EXISTS idx_payments_tenant_term ON payments(tenant_id, term_id);

-- Index for student fee assignment lookups
CREATE INDEX IF NOT EXISTS idx_sfa_student_term ON student_fee_assignments(student_id, term_id);

-- Index for transaction term-scoping (finance page, dashboard)
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_term ON transactions(tenant_id, term_id);

-- Drop the vestigial tenants.term column — superseded by the terms table.
ALTER TABLE tenants DROP COLUMN IF EXISTS term;

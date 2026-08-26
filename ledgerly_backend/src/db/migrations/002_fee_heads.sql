-- Phase 2: Fee heads and itemised student fees.
-- Replaces the single students.fee_amount with per-term, per-head billing.

CREATE TABLE IF NOT EXISTS fee_heads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_fee_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_head_id TEXT NOT NULL REFERENCES fee_heads(id),
  term_id TEXT NOT NULL REFERENCES terms(id),
  expected_amount REAL NOT NULL CHECK (expected_amount >= 0),
  discount_amount REAL NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_reason TEXT,
  discount_approved_by TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, fee_head_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_sfa_tenant_term ON student_fee_assignments(tenant_id, term_id);
CREATE INDEX IF NOT EXISTS idx_sfa_student ON student_fee_assignments(student_id);

-- Seed a default fee head catalogue per tenant
INSERT INTO fee_heads (id, tenant_id, name)
SELECT lower(hex(randomblob(16))), id, head
FROM tenants, (
  SELECT 'Tuition' AS head UNION ALL SELECT 'Boarding' UNION ALL SELECT 'Feeding'
  UNION ALL SELECT 'Development Levy' UNION ALL SELECT 'Exam Fees'
  UNION ALL SELECT 'Sports' UNION ALL SELECT 'Uniform'
);

-- Backfill: migrate each student's old single fee_amount into a "Tuition" assignment
-- on the tenant's current term, so no existing billing data is lost.
INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, created_by)
SELECT
  lower(hex(randomblob(16))),
  s.tenant_id,
  s.id,
  (SELECT id FROM fee_heads WHERE tenant_id = s.tenant_id AND name = 'Tuition' LIMIT 1),
  (SELECT id FROM terms WHERE tenant_id = s.tenant_id AND is_current = 1 LIMIT 1),
  s.fee_amount,
  s.created_by
FROM students s
WHERE s.fee_amount > 0;

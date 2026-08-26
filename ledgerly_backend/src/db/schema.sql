-- School Fee & Finance Tracker — schema
-- SQLite for local/dev portability. In production, port this 1:1 to PostgreSQL
-- and add row-level security policies keyed on tenant_id.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  term TEXT NOT NULL DEFAULT 'First Term',
  data_protection_contact TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','bursar','accountant','assistant')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  admission_no TEXT,
  guardian_contact TEXT,
  -- Pre-upgrade column. Migration 002 backfills this into student_fee_assignments;
  -- migration 006 drops it. Do not read or write in application code.
  fee_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  paid_on TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT,
  reversed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  description TEXT,
  occurred_on TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id),
  reversed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  ip_address TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_students_tenant ON students(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_student ON payments(tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant ON transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);

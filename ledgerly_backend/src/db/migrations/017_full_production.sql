-- Wave 1-7 migrations: all tables needed for full production.
-- Runs as a single migration to avoid ordering issues.

-- === WAVE 2: Payments + Subscriptions + Parent Portal ===
-- Subscriptions already exist from migration 016. Add Paystack references.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT;

-- Online payments (Paystack)
CREATE TABLE IF NOT EXISTS online_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_head_id TEXT REFERENCES fee_heads(id),
  term_id TEXT REFERENCES terms(id),
  amount REAL NOT NULL CHECK (amount > 0),
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','abandoned')),
  paystack_response TEXT,
  parent_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_online_payments_tenant ON online_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_online_payments_reference ON online_payments(reference);

-- Parent accounts (for parent portal)
CREATE TABLE IF NOT EXISTS parents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  password_hash TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

-- Link parents to students (a parent can have multiple students)
CREATE TABLE IF NOT EXISTS parent_students (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship TEXT DEFAULT 'parent',
  UNIQUE (parent_id, student_id)
);

-- === WAVE 3: Security ===
-- 2FA secrets
ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled INTEGER NOT NULL DEFAULT 0;

-- API keys
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT 'read',
  last_used_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TEXT
);

-- Session tracking (enhanced)
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- === WAVE 4: Banking + Term closing ===
-- Bank reconciliation
CREATE TABLE IF NOT EXISTS bank_statements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  total_records INTEGER DEFAULT 0,
  matched INTEGER DEFAULT 0,
  unmatched INTEGER DEFAULT 0,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  matched_payment_id TEXT REFERENCES payments(id),
  status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('matched','unmatched','ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Term closing
ALTER TABLE terms ADD COLUMN IF NOT EXISTS closed_at TEXT;
ALTER TABLE terms ADD COLUMN IF NOT EXISTS closed_by TEXT REFERENCES users(id);

-- Fee structure templates
CREATE TABLE IF NOT EXISTS fee_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  class_name TEXT,
  items TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payment plans
CREATE TABLE IF NOT EXISTS payment_plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_head_id TEXT NOT NULL REFERENCES fee_heads(id),
  term_id TEXT NOT NULL REFERENCES terms(id),
  total_amount REAL NOT NULL,
  installments INTEGER NOT NULL DEFAULT 1,
  paid_installments INTEGER NOT NULL DEFAULT 0,
  due_dates TEXT NOT NULL DEFAULT '[]',
  late_fee REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','defaulted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- === WAVE 5: Notifications + Global search ===
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  entity_type TEXT,
  entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read);

-- === WAVE 6: Webhooks ===
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  response_code INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- === WAVE 7: Multi-currency + Multi-school + White-label ===
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#14213D';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS parent_company TEXT;

-- Audit log retention
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS retention_expires_at TEXT;

-- === NDPR: Data export/deletion tracking ===
CREATE TABLE IF NOT EXISTS data_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('export','deletion')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','cancelled')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  processed_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

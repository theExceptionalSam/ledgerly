-- Platform admin Tier 1-3 support tables.

-- Tenant suspension support (status column already exists on users, add to tenants)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'));

-- Feature flags per tenant
CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature)
);

-- Per-tenant CRM notes (for the platform admin)
CREATE TABLE IF NOT EXISTS tenant_notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Broadcast messages (pushed to all or specific tenants)
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','success')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NPS / feedback from schools
CREATE TABLE IF NOT EXISTS nps_feedback (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deployment log (manual entries — auto-populated if CI/CD integration added later)
CREATE TABLE IF NOT EXISTS deployment_logs (
  id TEXT PRIMARY KEY,
  commit_sha TEXT,
  message TEXT,
  deployed_by TEXT,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Revenue tracking (subscription plans)
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','starter','standard','premium','enterprise')),
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','cancelled','trialing')),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  current_period_end TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert free subscriptions for all existing tenants
INSERT INTO subscriptions (id, tenant_id, plan, amount, status)
SELECT lower(hex(randomblob(16))), id, 'free', 0, 'active' FROM tenants
ON CONFLICT DO NOTHING;

-- Rate limit tracking (per-tenant API usage)
CREATE TABLE IF NOT EXISTS api_usage (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  endpoint TEXT,
  method TEXT,
  status_code INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_tenant_date ON api_usage(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);

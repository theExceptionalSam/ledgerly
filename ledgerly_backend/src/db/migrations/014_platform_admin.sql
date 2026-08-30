-- Platform admin table — separate auth for the platform operator dashboard.
-- Completely separate from tenant auth (different table, different token).

CREATE TABLE IF NOT EXISTS platform_admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default admin account — change the token in production!
INSERT INTO platform_admins (id, email, name, access_token)
VALUES ('admin-001', 'admin@ledgerly.app', 'Platform Admin', 'ledgerly-admin-change-this-token')
ON CONFLICT (email) DO NOTHING;

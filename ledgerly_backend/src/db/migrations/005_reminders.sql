-- Phase 5: Parent-facing reminders (SMS/WhatsApp).
-- reminders_enabled defaults to 0 (off). A tenant must explicitly turn this on
-- in settings before any bulk/scheduled sending is possible. This is a consent
-- and cost-control gate.

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  provider_message_id TEXT,
  sent_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_messaging_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  reminders_enabled INTEGER NOT NULL DEFAULT 0,
  default_channel TEXT NOT NULL DEFAULT 'sms' CHECK (default_channel IN ('sms','whatsapp')),
  message_template TEXT NOT NULL DEFAULT 'Dear parent/guardian, {studentName} has an outstanding balance of NGN {outstanding} for {termName}. Kindly clear this at your earliest convenience. — {schoolName}'
);

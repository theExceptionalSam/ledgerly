-- Make audit log deletions soft (archived) instead of hard-deleted.
-- Deleted entries get a deleted_at timestamp and are hidden from the
-- default list view, but can be viewed and restored.

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_audit_deleted ON audit_logs(tenant_id, deleted_at);

-- Add scheduled_for column to data_requests so the deletion cron can find
-- requests past their grace period.
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

-- Add 'failed' to the status CHECK constraint so requestExport's failure path
-- (which marks the row as 'failed' when CSV generation throws) can write its
-- terminal state. The original 017 constraint only allowed
-- ('pending','processing','completed','cancelled').
ALTER TABLE data_requests DROP CONSTRAINT IF EXISTS data_requests_status_check;
ALTER TABLE data_requests ADD CONSTRAINT data_requests_status_check
  CHECK (status IN ('pending','processing','completed','cancelled','failed'));

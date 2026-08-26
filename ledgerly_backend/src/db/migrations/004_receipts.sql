-- Phase 3: Receipts.
-- One receipt per payment, with a sequential per-tenant receipt number.
-- The number is generated inside the same transaction that inserts the receipt
-- row, to avoid race conditions on the counter.

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  issued_by TEXT NOT NULL REFERENCES users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number)
);

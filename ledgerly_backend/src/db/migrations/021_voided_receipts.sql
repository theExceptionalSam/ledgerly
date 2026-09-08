-- Voided receipt register.
--
-- A voided receipt is NOT deleted — the row stays in the receipts table for
-- audit integrity (the receipt number was issued and can never be reused, so
-- the row must remain to explain the gap in the sequence). Instead, three
-- nullable columns mark the receipt as voided: who voided it, when, and why.
--
-- Voiding is owner-only (see receipts.controller.voidReceipt). The listReceipts
-- endpoint excludes voided receipts by default; the owner/accountant can list
-- them explicitly via GET /receipts/voided or pass ?includeVoided=true to the
-- main list endpoint.
--
-- voided_at is TIMESTAMPTZ (unlike terms.closed_at which is TEXT for historical
-- reasons — receipts is a newer table so we use the proper type from the start).

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS voided_by TEXT REFERENCES users(id);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_receipts_voided ON receipts(tenant_id, voided_at) WHERE voided_at IS NOT NULL;

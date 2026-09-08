-- Reversal approval workflow.
--
-- Direct payment reversals are now owner-only (see payments.controller.reversePayment).
-- Bursars and accountants who need to correct a recorded payment must submit a
-- reversal request, which the owner then approves or rejects. This adds an
-- oversight step so a single staff member can't both record and erase a payment.
--
-- The request row is created with status='pending' and does NOT touch the
-- payment row. On approval, the controller flips status to 'approved' AND
-- performs the actual reversal (UPDATE payments SET reversed = 1) in the same
-- transaction. On rejection, status flips to 'rejected' with no payment change.
--
-- The payment_id FK cascades on delete — but payments are never hard-deleted in
-- this codebase (a correction is always a reversing entry), so the cascade is
-- just belt-and-suspenders.

CREATE TABLE IF NOT EXISTS reversal_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by TEXT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reversal_requests_tenant_status ON reversal_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_reversal_requests_payment ON reversal_requests(payment_id);

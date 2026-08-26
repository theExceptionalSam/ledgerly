-- Phase 2 (cont.): Link payments to fee heads and terms.
-- fee_head_id is required for new payments (enforced in the controller, not
-- the column, since SQLite cannot add a NOT NULL column with no default to an
-- existing table cleanly).

ALTER TABLE payments ADD COLUMN fee_head_id TEXT REFERENCES fee_heads(id);
ALTER TABLE payments ADD COLUMN term_id TEXT REFERENCES terms(id);

-- Backfill existing payments onto the Tuition head / current term, matching the
-- assignment backfill above, so historic figures stay consistent.
UPDATE payments
SET fee_head_id = (SELECT sfa.fee_head_id FROM student_fee_assignments sfa WHERE sfa.student_id = payments.student_id AND sfa.fee_head_id IN (SELECT id FROM fee_heads WHERE name = 'Tuition' AND tenant_id = payments.tenant_id) LIMIT 1),
    term_id = (SELECT id FROM terms WHERE tenant_id = payments.tenant_id AND is_current = 1 LIMIT 1)
WHERE fee_head_id IS NULL;

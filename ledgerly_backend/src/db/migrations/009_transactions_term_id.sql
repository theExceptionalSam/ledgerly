-- Make income/expenditure transactions term-scoped.
-- The transactions table previously had no term_id, so income and expenditure
-- entries appeared in every term's dashboard. This adds term_id (nullable for
-- backward compat) and backfills existing rows to the tenant's current term.

ALTER TABLE transactions ADD COLUMN term_id TEXT REFERENCES terms(id) ON DELETE SET NULL;

-- Backfill: link every existing transaction to the tenant's current term.
UPDATE transactions
SET term_id = (SELECT id FROM terms WHERE tenant_id = transactions.tenant_id AND is_current = 1 LIMIT 1)
WHERE term_id IS NULL;

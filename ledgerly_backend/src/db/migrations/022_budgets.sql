-- Budget vs Actual tracking.
--
-- The owner sets an expected-revenue budget per (term, class). The dashboard
-- and the /budgets endpoints JOIN this table with payments to compute the
-- actual amount collected per class and show the variance.
--
-- One budget row per (tenant_id, term_id, class_name) — enforced by the
-- UNIQUE constraint. The upsert handler (budgets.controller.upsertBudget)
-- relies on this constraint to do INSERT ... ON CONFLICT DO UPDATE.
--
-- class_name is stored as TEXT (not a FK to a classes table) because this
-- codebase has no classes table — students.class is a free-text field. The
-- budget's class_name is matched against students.class in the actual-collected
-- subquery, so they must use the same string. If a school renames a class,
-- the owner must update the budget row too (there's no cascade).

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  expected_amount REAL NOT NULL CHECK (expected_amount >= 0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, term_id, class_name)
);

CREATE INDEX IF NOT EXISTS idx_budgets_tenant_term ON budgets(tenant_id, term_id);

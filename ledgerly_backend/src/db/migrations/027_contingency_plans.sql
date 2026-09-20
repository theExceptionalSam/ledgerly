-- Contingency Planning module — financial risk early-warning and response system.
--
-- Each plan captures a structured workflow:
--   Risk → Impact → Signal → Trigger → Response → Resources → Recovery
--
-- Plans have a status lifecycle (draft → prepared → monitoring → triggered →
-- active → under_review → resolved → archived) and are connected to the
-- school's financial data for automated trigger detection.
--
-- contingency_events records the immutable audit trail for each plan:
-- who created/modified/triggered/resolved it, what changed, and when.

CREATE TABLE IF NOT EXISTS contingency_plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,

  -- 1. Financial Risk
  risk_description TEXT NOT NULL,
  risk_category TEXT, -- lower_fee_collection, delayed_payments, unexpected_repairs, emergency_expenditure, operating_cost_increase, payroll_pressure, utility_cost_increase, supplier_price_increase, funding_shortfall, cashflow_shortage, unplanned_capex, other

  -- 2. Financial Impact
  impact_estimate_min REAL,
  impact_estimate_max REAL,
  impact_type TEXT, -- loss, additional_expense, delayed_income, cashflow_gap
  impact_currency TEXT DEFAULT 'NGN',
  impact_duration_days INTEGER, -- expected duration of impact

  -- 3. Warning Signal
  signal_type TEXT, -- manual, collection_below_pct, cash_below_amount, expenses_above_budget_pct, outstanding_above_amount, payroll_below_pct, custom
  signal_threshold_value REAL, -- the numeric threshold (percentage or amount)
  signal_description TEXT, -- human-readable description of the warning signal

  -- 4. Trigger Point
  trigger_type TEXT, -- amount, percentage, date, deadline, balance, overdue_count, custom
  trigger_value TEXT, -- the value (amount, percentage, ISO date, count, etc.)
  trigger_description TEXT,

  -- 5. Response (JSON array of action objects: [{action, order, done}])
  response_actions TEXT, -- JSON string

  -- 6. Cost Adjustment (JSON array: [{item, type: reduce|delay|cancel, amount, essential: bool}])
  cost_adjustments TEXT, -- JSON string

  -- 7. Funding Response (JSON array: [{source, amount, verified: bool}])
  funding_sources TEXT, -- JSON string

  -- 8. Responsibility
  responsible_person TEXT,
  responsible_role TEXT,
  stakeholders TEXT,
  approval_authority TEXT,

  -- 9. Resources (JSON: {money, people, approvals, documents, tools, time})
  required_resources TEXT, -- JSON string

  -- 10. Spending Limit
  spending_limit REAL,
  approval_threshold REAL,
  spending_authority TEXT,
  escalation_point TEXT,

  -- 11. Duration
  expected_duration_days INTEGER,
  start_date TEXT,
  review_date TEXT,
  max_sustainable_days INTEGER,

  -- 12. Recovery
  recovery_actions TEXT, -- JSON array of strings
  recovery_target TEXT,
  recovery_responsible TEXT,
  recovery_review_date TEXT,
  recovery_conditions TEXT, -- conditions required to deactivate

  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','prepared','monitoring','triggered','active','under_review','resolved','archived')),
  triggered_at TIMESTAMPTZ,
  triggered_by TEXT, -- user id who activated (or 'system' for auto-trigger)
  resolved_at TIMESTAMPTZ,

  -- Ownership
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contingency_tenant ON contingency_plans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contingency_status ON contingency_plans(tenant_id, status);

-- Immutable event log for each plan — who did what, when, with what amounts.
CREATE TABLE IF NOT EXISTS contingency_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES contingency_plans(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- created, modified, status_changed, triggered, action_taken, resolved, reviewed, auto_triggered
  event_description TEXT,
  event_data TEXT, -- JSON: what changed (diff, amounts, etc.)
  actor_user_id TEXT, -- NULL for system-generated events
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contingency_events_plan ON contingency_events(plan_id);
CREATE INDEX IF NOT EXISTS idx_contingency_events_tenant ON contingency_events(tenant_id, created_at DESC);

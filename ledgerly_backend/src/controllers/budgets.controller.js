const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Budget vs Actual tracking.
//
// The owner sets an expected-revenue budget per (term, class). The handlers
// here compute the actual amount collected per class by joining payments with
// students (students.class is the free-text class label) and return the
// variance (actual - expected). A positive variance means the school collected
// more than budgeted; negative means a shortfall.
//
// All money values are returned as JS numbers — pg returns REAL/numeric as
// strings in some configs, so we wrap every amount in Number() to be safe.

// Compute the actual amount collected for one (tenant, term, class) — used
// inline as a correlated subquery in the list/summary queries. Kept here as
// a string so the SQL is identical between the two call sites (which makes
// the numbers comparable across endpoints).
const ACTUAL_COLLECTED_SUBQUERY = `
  COALESCE((
    SELECT SUM(p.amount)
    FROM payments p
    JOIN students s ON s.id = p.student_id
    WHERE p.tenant_id = b.tenant_id
      AND p.term_id = b.term_id
      AND p.reversed = 0
      AND s.class = b.class_name
  ), 0)
`;

// GET /api/v1/budgets?termId=<uuid>
// List all budgets for the tenant, optionally filtered by term. Each row
// includes the actual collected and the variance.
async function listBudgets(req, res) {
  const { tenantId } = req.user;
  const { termId } = req.query;

  const params = [tenantId];
  let termClause = '';
  if (termId) {
    params.push(termId);
    termClause = `AND b.term_id = $${params.length}`;
  }

  const { rows } = await db.query(`
    SELECT b.id, b.term_id, b.class_name, b.expected_amount, b.created_at,
           ${ACTUAL_COLLECTED_SUBQUERY} AS actual_collected,
           t.name AS term_name
    FROM budgets b
    LEFT JOIN terms t ON t.id = b.term_id
    WHERE b.tenant_id = $1 ${termClause}
    ORDER BY t.name NULLS LAST, b.class_name
  `, params);

  const budgets = rows.map((r) => {
    const expected = Number(r.expected_amount);
    const actual = Number(r.actual_collected);
    return {
      id: r.id,
      termId: r.term_id,
      termName: r.term_name,
      className: r.class_name,
      expectedAmount: expected,
      actualCollected: actual,
      variance: actual - expected,
      createdAt: r.created_at,
    };
  });

  res.json({ budgets });
}

// POST /api/v1/budgets  (owner only)
// Create or update a budget for (termId, className). The UNIQUE(tenant_id,
// term_id, class_name) constraint turns this into an upsert: a second POST for
// the same trio updates the expected_amount instead of erroring.
async function upsertBudget(req, res) {
  const { tenantId, id: userId } = req.user;
  const { termId, className, expectedAmount } = req.body;
  const cleanClassName = String(className).trim();

  // Verify the term belongs to this tenant — prevents a budget row from
  // ever pointing at another tenant's term via a guessed UUID.
  const { rows: termRows } = await db.query(
    `SELECT id FROM terms WHERE id = $1 AND tenant_id = $2`,
    [termId, tenantId]
  );
  if (!termRows[0]) return res.status(404).json({ error: 'Term not found' });

  const id = randomUUID();
  const { rows } = await db.query(`
    INSERT INTO budgets (id, tenant_id, term_id, class_name, expected_amount, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id, term_id, class_name)
    DO UPDATE SET expected_amount = EXCLUDED.expected_amount
    RETURNING id, (xmax = 0) AS inserted
  `, [id, tenantId, termId, cleanClassName, expectedAmount, userId]);

  const result = rows[0];
  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: result.inserted ? 'create' : 'update',
    entityType: 'budget',
    entityId: result.id,
    ipAddress: req.ip,
    metadata: { termId, className: cleanClassName, expectedAmount },
  });

  res.status(result.inserted ? 201 : 200).json({
    id: result.id,
    termId,
    className: cleanClassName,
    expectedAmount: Number(expectedAmount),
    created: result.inserted,
  });
}

// DELETE /api/v1/budgets/:id  (owner only)
async function deleteBudget(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  // RETURNING the row so we can log what was deleted in the audit trail —
  // a bare DELETE would leave no trace of which class/term/amount was removed.
  const { rows } = await db.query(
    `DELETE FROM budgets WHERE id = $1 AND tenant_id = $2
     RETURNING id, term_id, class_name, expected_amount`,
    [id, tenantId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Budget not found' });

  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'delete',
    entityType: 'budget',
    entityId: id,
    ipAddress: req.ip,
    metadata: {
      termId: rows[0].term_id,
      className: rows[0].class_name,
      expectedAmount: Number(rows[0].expected_amount),
    },
  });

  res.json({ ok: true });
}

// GET /api/v1/budgets/summary?termId=<uuid>
// Summary for a single term: total budget, total actual, total variance, and
// a per-class breakdown. Used by the dashboard's "Budget vs Actual" panel.
async function getBudgetSummary(req, res) {
  const { tenantId } = req.user;
  const { termId } = req.query;

  const { rows } = await db.query(`
    SELECT b.class_name, b.expected_amount,
           ${ACTUAL_COLLECTED_SUBQUERY} AS actual_collected
    FROM budgets b
    WHERE b.tenant_id = $1 AND b.term_id = $2
    ORDER BY b.class_name
  `, [tenantId, termId]);

  const perClass = rows.map((r) => {
    const expected = Number(r.expected_amount);
    const actual = Number(r.actual_collected);
    return {
      className: r.class_name,
      expected,
      actual,
      variance: actual - expected,
    };
  });

  const totalBudget = perClass.reduce((sum, r) => sum + r.expected, 0);
  const totalActual = perClass.reduce((sum, r) => sum + r.actual, 0);

  res.json({
    termId,
    totalBudget,
    totalActual,
    totalVariance: totalActual - totalBudget,
    perClass,
  });
}

module.exports = { listBudgets, upsertBudget, deleteBudget, getBudgetSummary };

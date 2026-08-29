const db = require('../db');

// Phase 2: dashboard totals are now term-scoped and based on student_fee_assignments
// (expected minus discount) instead of the deprecated students.fee_amount column.
// termId comes from ?termId= and defaults to the tenant's current term.

async function getDashboard(req, res) {
  const { tenantId } = req.user;

  let termId = req.query.termId;
  if (!termId) {
    const { rows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
    const current = rows[0];
    termId = current ? current.id : null;
  }
  if (!termId) {
    return res.json({ expected: 0, collected: 0, outstanding: 0, studentCount: 0, fullyPaid: 0, partial: 0, fullyOutstanding: 0, otherIncome: 0, expenditure: 0, netPosition: 0, termId: null });
  }

  // Expected = sum of (expected_amount - discount_amount) across all assignments for this term.
  const { rows: feeRows } = await db.query(`
    SELECT
      COALESCE(SUM(expected_amount - discount_amount), 0) AS expected,
      COUNT(DISTINCT student_id) AS student_count
    FROM student_fee_assignments
    WHERE tenant_id = $1 AND term_id = $2
  `, [tenantId, termId]);
  const feeTotals = feeRows[0];

  const expected = Number(feeTotals.expected) || 0;
  const studentCount = feeTotals.student_count || 0;

  // Collected = sum of non-reversed payments in this term.
  // No JOIN to students: payments are never made for archived students, and even if
  // they were, they should count toward collected. The expected/per-student counts
  // above also include all students, so this keeps the three metrics consistent.
  const { rows: collectedRows } = await db.query(`
    SELECT COALESCE(SUM(amount), 0) AS collected
    FROM payments
    WHERE tenant_id = $1 AND term_id = $2 AND reversed = 0
  `, [tenantId, termId]);
  const collected = collectedRows[0].collected;

  // Per-student status counts for this term.
  // Uses a LEFT JOIN against a pre-aggregated payments subquery instead of a
  // correlated subquery — Postgres (unlike SQLite) forbids correlated subqueries
  // from referencing non-grouped columns in a GROUP BY query.
  const { rows: perStudent } = await db.query(`
    SELECT sfa.student_id,
      SUM(sfa.expected_amount - sfa.discount_amount) AS expected,
      COALESCE(ps.paid, 0) AS paid
    FROM student_fee_assignments sfa
    LEFT JOIN (
      SELECT student_id, SUM(amount) AS paid
      FROM payments
      WHERE tenant_id = $1 AND term_id = $2 AND reversed = 0
      GROUP BY student_id
    ) ps ON ps.student_id = sfa.student_id
    WHERE sfa.tenant_id = $3 AND sfa.term_id = $4
    GROUP BY sfa.student_id, ps.paid
  `, [tenantId, termId, tenantId, termId]);

  let fullyPaid = 0, partial = 0, outstanding = 0;
  for (const s of perStudent) {
    const exp = Number(s.expected) || 0;
    const paid = Number(s.paid) || 0;
    if (exp <= 0) continue;
    if (paid >= exp) fullyPaid++;
    else if (paid > 0) partial++;
    else outstanding++;
  }

  const { rows: incomeRows } = await db.query(`SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE tenant_id = $1 AND type = 'income' AND reversed = 0 AND term_id = $2`, [tenantId, termId]);
  const otherIncome = incomeRows[0].v;
  const { rows: expenseRows } = await db.query(`SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE tenant_id = $1 AND type = 'expense' AND reversed = 0 AND term_id = $2`, [tenantId, termId]);
  const expenditure = expenseRows[0].v;

  res.json({
    expected,
    collected: Number(collected) || 0,
    outstanding: expected - Number(collected || 0),
    studentCount,
    fullyPaid,
    partial,
    fullyOutstanding: outstanding,
    otherIncome,
    expenditure,
    netPosition: Number(collected || 0) + otherIncome - expenditure,
    termId,
  });
}

module.exports = { getDashboard };

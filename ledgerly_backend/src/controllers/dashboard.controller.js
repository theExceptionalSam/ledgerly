const db = require('../db');

function getDashboard(req, res) {
  const { tenantId } = req.user;

  const feeTotals = db.prepare(`
    SELECT
      COALESCE(SUM(fee_amount), 0) AS expected,
      COUNT(*) AS student_count
    FROM students WHERE tenant_id = ? AND status = 'active'
  `).get(tenantId);

  const collected = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS collected
    FROM payments p
    JOIN students s ON s.id = p.student_id
    WHERE p.tenant_id = ? AND p.reversed = 0 AND s.status = 'active'
  `).get(tenantId).collected;

  const statusCounts = db.prepare(`
    SELECT s.id, s.fee_amount,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.student_id = s.id AND p.reversed = 0), 0) AS paid
    FROM students s WHERE s.tenant_id = ? AND s.status = 'active'
  `).all(tenantId);

  let fullyPaid = 0, partial = 0, outstanding = 0;
  for (const s of statusCounts) {
    if (s.fee_amount <= 0) continue;
    if (s.paid >= s.fee_amount) fullyPaid++;
    else if (s.paid > 0) partial++;
    else outstanding++;
  }

  const otherIncome = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE tenant_id = ? AND type = 'income' AND reversed = 0`).get(tenantId).v;
  const expenditure = db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM transactions WHERE tenant_id = ? AND type = 'expense' AND reversed = 0`).get(tenantId).v;

  res.json({
    expected: feeTotals.expected,
    collected,
    outstanding: feeTotals.expected - collected,
    studentCount: feeTotals.student_count,
    fullyPaid,
    partial,
    fullyOutstanding: outstanding,
    otherIncome,
    expenditure,
    netPosition: collected + otherIncome - expenditure,
  });
}

module.exports = { getDashboard };

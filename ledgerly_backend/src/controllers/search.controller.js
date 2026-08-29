const db = require('../db');

// Global search — one query box that searches across the entity types the user
// is most likely looking for. Each type is capped (LIMIT) so a wildcard search
// doesn't return thousands of rows.
//
// Tenant-scoped — req.user.tenantId is always applied, never trusted from input.

async function search(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ students: [], payments: [], transactions: [], receipts: [] });

  const like = `%${q}%`;
  // Payments: match by amount (if q parses as a number) or by note ILIKE.
  const numeric = parseFloat(q);
  const numericValid = Number.isFinite(numeric) && numeric > 0;

  const [studentsRes, paymentsRes, transactionsRes, receiptsRes] = await Promise.all([
    db.query(
      `SELECT id, name, class, admission_no FROM students
       WHERE tenant_id = $1 AND status = 'active'
         AND (name ILIKE $2 OR admission_no ILIKE $2 OR class ILIKE $2)
       ORDER BY name ASC LIMIT 20`,
      [req.user.tenantId, like]
    ),
    db.query(
      `SELECT p.id, p.amount, p.method, p.note, p.paid_on, p.student_id, s.name AS student_name, fh.name AS fee_head_name
       FROM payments p
       LEFT JOIN students s ON s.id = p.student_id
       LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
       WHERE p.tenant_id = $1 AND p.reversed = 0
         AND (${numericValid ? 'p.amount = $3 OR ' : ''}p.note ILIKE $2)
       ORDER BY p.paid_on DESC LIMIT 20`,
      numericValid ? [req.user.tenantId, like, numeric] : [req.user.tenantId, like]
    ),
    db.query(
      `SELECT id, type, category, amount, description, occurred_on
       FROM transactions
       WHERE tenant_id = $1 AND reversed = 0
         AND (category ILIKE $2 OR description ILIKE $2)
       ORDER BY occurred_on DESC LIMIT 20`,
      [req.user.tenantId, like]
    ),
    db.query(
      `SELECT r.id, r.receipt_number, r.issued_at, p.amount, s.name AS student_name
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       LEFT JOIN students s ON s.id = p.student_id
       WHERE r.tenant_id = $1 AND r.receipt_number ILIKE $2
       ORDER BY r.issued_at DESC LIMIT 20`,
      [req.user.tenantId, like]
    ),
  ]);

  res.json({
    students: studentsRes.rows,
    payments: paymentsRes.rows,
    transactions: transactionsRes.rows,
    receipts: receiptsRes.rows,
  });
}

module.exports = { search };

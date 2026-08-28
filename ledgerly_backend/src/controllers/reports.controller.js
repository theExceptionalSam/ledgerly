const db = require('../db');

// Reports — aggregated financial data for school owners.
// All scoped by tenant_id + term_id.

async function getReports(req, res) {
  const { tenantId } = req.user;
  let termId = req.query.termId;
  if (!termId) {
    const { rows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
    termId = rows[0]?.id;
  }
  if (!termId) return res.json({ monthlyCollection: [], defaulters: [], fullyPaid: [], summary: { total: 0, collected: 0, outstanding: 0, studentCount: 0 } });

  // Monthly collection breakdown
  const { rows: monthly } = await db.query(`
    SELECT
      substr(p.paid_on, 1, 7) AS month,
      COUNT(*) AS payment_count,
      COALESCE(SUM(p.amount), 0) AS total
    FROM payments p
    WHERE p.tenant_id = $1 AND p.term_id = $2 AND p.reversed = 0
    GROUP BY substr(p.paid_on, 1, 7)
    ORDER BY month
  `, [tenantId, termId]);

  // Defaulter list — students with outstanding > 0
  const { rows: defaulters } = await db.query(`
    SELECT s.id, s.name, s.class, s.admission_no, s.guardian_contact,
      COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) AS expected,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) AS paid
    FROM students s
    JOIN student_fee_assignments sfa ON sfa.student_id = s.id AND sfa.term_id = $2
    WHERE s.tenant_id = $1 AND s.status = 'active'
    GROUP BY s.id, s.name, s.class, s.admission_no, s.guardian_contact
    HAVING COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) > 0
    ORDER BY (COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0)) DESC
  `, [tenantId, termId]);

  // Fully paid list — students who have paid everything
  const { rows: fullyPaid } = await db.query(`
    SELECT s.id, s.name, s.class, s.admission_no,
      COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) AS expected,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) AS paid
    FROM students s
    JOIN student_fee_assignments sfa ON sfa.student_id = s.id AND sfa.term_id = $2
    WHERE s.tenant_id = $1 AND s.status = 'active'
    GROUP BY s.id, s.name, s.class, s.admission_no
    HAVING COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) >= COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0)
    ORDER BY s.name
  `, [tenantId, termId]);

  // Summary
  const { rows: summaryRows } = await db.query(`
    SELECT
      COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) AS total,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.tenant_id = $1 AND p.term_id = $2 AND p.reversed = 0), 0) AS collected,
      COUNT(DISTINCT sfa.student_id) AS student_count
    FROM student_fee_assignments sfa
    WHERE sfa.tenant_id = $1 AND sfa.term_id = $2
  `, [tenantId, termId]);

  const summary = {
    total: Number(summaryRows[0]?.total) || 0,
    collected: Number(summaryRows[0]?.collected) || 0,
    outstanding: (Number(summaryRows[0]?.total) || 0) - (Number(summaryRows[0]?.collected) || 0),
    studentCount: Number(summaryRows[0]?.student_count) || 0,
  };

  res.json({
    monthlyCollection: monthly.map(m => ({ month: m.month, count: Number(m.payment_count), total: Number(m.total) })),
    defaulters: defaulters.map(d => ({
      ...d,
      expected: Number(d.expected),
      paid: Number(d.paid),
      outstanding: Number(d.expected) - Number(d.paid),
    })),
    fullyPaid: fullyPaid.map(f => ({ ...f, expected: Number(f.expected), paid: Number(f.paid) })),
    summary,
  });
}

module.exports = { getReports };

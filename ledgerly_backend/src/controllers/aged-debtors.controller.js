const db = require('../db');

// Aged debtors report — buckets outstanding fees by age.
//
// This is the standard "who owes us money and how late are they?" report every
// school auditor asks for. For each student with an outstanding balance in the
// selected term, the balance is bucketed by how long it has been overdue:
//
//   0-30 days | 31-60 days | 61-90 days | 90+ days
//
// Age is calculated from the term's end date — the assumption being that fees
// were due by the end of the term, so once the term ends the outstanding
// balance starts ageing. If the term is still active (no end_date), the
// reference date is today and the age is 0 (everything falls in 0-30).
//
// Returns a per-student breakdown plus bucket totals. Owner/accountant only.

async function getAgedDebtors(req, res) {
  const { tenantId } = req.user;
  const { termId } = req.query;

  // Resolve the term — default to the tenant's current term if none was
  // requested. If the tenant has no current term either, return an empty
  // report rather than a 404 (this is a read-only view).
  let resolvedTermId = termId;
  if (!resolvedTermId) {
    const { rows: currentRows } = await db.query(
      `SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`,
      [tenantId]
    );
    resolvedTermId = currentRows[0]?.id;
  }
  if (!resolvedTermId) {
    return res.json({ buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }, students: [], total: 0, referenceDate: null, termId: null });
  }

  // Get the term's end date — the anchor for the age calculation.
  const { rows: termRows } = await db.query(
    `SELECT end_date FROM terms WHERE id = $1 AND tenant_id = $2`,
    [resolvedTermId, tenantId]
  );
  const termEndDate = termRows[0]?.end_date;
  // If the term has no end_date (still active / not yet filled in), age
  // everything from today → 0 days overdue.
  const referenceDate = termEndDate || new Date().toISOString().slice(0, 10);

  // Pull every active student in the tenant with their expected (minus
  // discounts) and paid totals for this term. The HAVING clause filters to
  // only students who actually owe something — no point bucketing zero
  // balances.
  //
  // Notes on the paid subquery:
  //  - reversed = 0 excludes reversed payments (INTEGER 0/1 per schema)
  //  - term_id on payments was added by migration 003
  //  - correlated subquery (rather than a JOIN aggregate) so the expected
  //    SUM and paid SUM are computed independently and don't interfere
  const { rows: students } = await db.query(`
    SELECT s.id, s.name, s.class,
           COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) AS expected,
           COALESCE((SELECT SUM(p.amount) FROM payments p
                     WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) AS paid
    FROM students s
    LEFT JOIN student_fee_assignments sfa ON sfa.student_id = s.id AND sfa.term_id = $2
    WHERE s.tenant_id = $1 AND s.status = 'active'
    GROUP BY s.id, s.name, s.class
    HAVING COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) >
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0)
    ORDER BY s.class, s.name
  `, [tenantId, resolvedTermId]);

  // Bucket each student's outstanding balance. All students share the same
  // reference date (the term's end date), so they all land in the same bucket
  // for a given term — that's correct for the "fees were due by term end"
  // model. The per-student daysOverdue is reported for transparency.
  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const studentBreakdown = [];

  for (const s of students) {
    const expected = Number(s.expected);
    const paid = Number(s.paid);
    const outstanding = expected - paid;
    if (outstanding <= 0) continue;

    // Days overdue = today - reference date. If the term hasn't ended yet,
    // reference date is today → 0 days. Clamp at 0 so a slightly-future
    // term end date doesn't produce negative ages.
    const ref = new Date(referenceDate);
    const now = new Date();
    const daysOverdue = Math.max(0, Math.floor((now - ref) / (1000 * 60 * 60 * 24)));

    let bucket;
    if (daysOverdue <= 30) bucket = '0-30';
    else if (daysOverdue <= 60) bucket = '31-60';
    else if (daysOverdue <= 90) bucket = '61-90';
    else bucket = '90+';

    buckets[bucket] += outstanding;
    studentBreakdown.push({
      studentId: s.id,
      studentName: s.name,
      class: s.class,
      expected,
      paid,
      outstanding,
      daysOverdue,
      bucket,
    });
  }

  const total = Object.values(buckets).reduce((a, b) => a + b, 0);

  res.json({
    termId: resolvedTermId,
    referenceDate,
    buckets,
    total,
    students: studentBreakdown,
  });
}

// Boarding-specific aged-debtors report.
//
// Identical to `getAgedDebtors` but the student set is narrowed to
// `student_type = 'boarding'`. This is the view a bursar uses to see which
// boarding students haven't paid their boarding-related fees — a frequent
// operational concern because boarding fees are typically large and a single
// non-payer ties up a dorm bed that could go to a paying student.
//
// Route: GET /aged-debtors/boarding?termId=
async function getBoardingReport(req, res) {
  const { tenantId } = req.user;
  const { termId } = req.query;

  // Resolve the term — default to the tenant's current term if none was
  // requested. Same logic as getAgedDebtors; extracted here so the boarding
  // report is self-contained (no shared helper to refactor).
  let resolvedTermId = termId;
  if (!resolvedTermId) {
    const { rows: currentRows } = await db.query(
      `SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`,
      [tenantId]
    );
    resolvedTermId = currentRows[0]?.id;
  }
  if (!resolvedTermId) {
    return res.json({ buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }, students: [], total: 0, referenceDate: null, termId: null, studentType: 'boarding' });
  }

  const { rows: termRows } = await db.query(
    `SELECT end_date FROM terms WHERE id = $1 AND tenant_id = $2`,
    [resolvedTermId, tenantId]
  );
  const termEndDate = termRows[0]?.end_date;
  const referenceDate = termEndDate || new Date().toISOString().slice(0, 10);

  // Same outstanding-fee query as getAgedDebtors, with the additional
  // `s.student_type = 'boarding'` predicate. Inline literal is safe here
  // (the value is a constant — never user input).
  const { rows: students } = await db.query(`
    SELECT s.id, s.name, s.class,
           COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) AS expected,
           COALESCE((SELECT SUM(p.amount) FROM payments p
                     WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) AS paid
    FROM students s
    LEFT JOIN student_fee_assignments sfa ON sfa.student_id = s.id AND sfa.term_id = $2
    WHERE s.tenant_id = $1 AND s.status = 'active' AND s.student_type = 'boarding'
    GROUP BY s.id, s.name, s.class
    HAVING COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) >
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0)
    ORDER BY s.class, s.name
  `, [tenantId, resolvedTermId]);

  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const studentBreakdown = [];

  for (const s of students) {
    const expected = Number(s.expected);
    const paid = Number(s.paid);
    const outstanding = expected - paid;
    if (outstanding <= 0) continue;

    const ref = new Date(referenceDate);
    const now = new Date();
    const daysOverdue = Math.max(0, Math.floor((now - ref) / (1000 * 60 * 60 * 24)));

    let bucket;
    if (daysOverdue <= 30) bucket = '0-30';
    else if (daysOverdue <= 60) bucket = '31-60';
    else if (daysOverdue <= 90) bucket = '61-90';
    else bucket = '90+';

    buckets[bucket] += outstanding;
    studentBreakdown.push({
      studentId: s.id,
      studentName: s.name,
      class: s.class,
      studentType: 'boarding',
      expected,
      paid,
      outstanding,
      daysOverdue,
      bucket,
    });
  }

  const total = Object.values(buckets).reduce((a, b) => a + b, 0);

  res.json({
    termId: resolvedTermId,
    referenceDate,
    buckets,
    total,
    students: studentBreakdown,
    studentType: 'boarding',
  });
}

module.exports = { getAgedDebtors, getBoardingReport };

const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Carry over outstanding balances from one term to another.
// For each student with outstanding fees in the source term, creates a new
// fee assignment in the target term labeled as "Outstanding (Carried Over)".
//
// Logic:
// 1. Find all students with outstanding = expected - paid > 0 in the source term
// 2. For each, create a fee assignment in the target term:
//    - fee_head_id = a special "Outstanding" fee head (create if not exists)
//    - expected_amount = the outstanding amount
//    - discount_amount = 0
// 3. Skip students who already have a carry-over assignment (idempotent)
//
// The "Outstanding (Carried Over)" fee head is auto-created per tenant if it
// doesn't exist. NOTE: the fee_heads table has no created_by column (see
// migration 002), so the INSERT omits it — unlike student_fee_assignments
// which does have created_by.

async function carryOverOutstanding(req, res) {
  const { tenantId, id: userId } = req.user;
  const { sourceTermId, targetTermId } = req.body;

  // Validate both terms belong to the tenant
  const { rows: termRows } = await db.query(
    `SELECT id, name, closed_at FROM terms WHERE id = ANY($1::text[]) AND tenant_id = $2`,
    [[sourceTermId, targetTermId], tenantId]
  );
  if (termRows.length !== 2) return res.status(404).json({ error: 'One or both terms not found' });

  const sourceTerm = termRows.find(t => t.id === sourceTermId);
  const targetTerm = termRows.find(t => t.id === targetTermId);

  if (!sourceTerm.closed_at) {
    return res.status(400).json({ error: 'Source term must be closed before carrying over outstanding balances' });
  }
  if (sourceTermId === targetTermId) {
    return res.status(400).json({ error: 'Source and target terms must be different' });
  }
  if (targetTerm.closed_at) {
    return res.status(400).json({ error: 'Target term must be open (not closed)' });
  }

  // Find or create the "Outstanding (Carried Over)" fee head for this tenant.
  // The fee_heads table has columns: id, tenant_id, name, is_active, created_at
  // (migration 002) — no created_by, so the INSERT below omits it.
  let { rows: feeHeadRows } = await db.query(
    `SELECT id FROM fee_heads WHERE tenant_id = $1 AND name = 'Outstanding (Carried Over)' AND is_active = 1`,
    [tenantId]
  );
  let outstandingFeeHeadId;
  if (!feeHeadRows[0]) {
    outstandingFeeHeadId = randomUUID();
    await db.query(
      `INSERT INTO fee_heads (id, tenant_id, name, is_active) VALUES ($1, $2, $3, 1)`,
      [outstandingFeeHeadId, tenantId, 'Outstanding (Carried Over)']
    );
  } else {
    outstandingFeeHeadId = feeHeadRows[0].id;
  }

  // Find all students with outstanding balances in the source term.
  // outstanding = SUM(expected_amount - discount_amount) - SUM(payments).
  // Payments are filtered to non-reversed rows in the source term.
  const { rows: students } = await db.query(`
    SELECT s.id, s.name,
           COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) AS expected,
           COALESCE((SELECT SUM(p.amount) FROM payments p
                     WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) AS paid
    FROM students s
    LEFT JOIN student_fee_assignments sfa ON sfa.student_id = s.id AND sfa.term_id = $2
    WHERE s.tenant_id = $1 AND s.status = 'active'
    GROUP BY s.id, s.name
    HAVING COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) >
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0)
  `, [tenantId, sourceTermId]);

  if (students.length === 0) {
    await recordAudit({
      tenantId, actorUserId: userId, action: 'create', entityType: 'carry_over', entityId: null,
      ipAddress: req.ip,
      metadata: { sourceTermId, sourceTermName: sourceTerm.name, targetTermId, targetTermName: targetTerm.name, carriedOver: 0, skipped: 0, noop: true }
    });
    return res.json({ ok: true, carriedOver: 0, skipped: 0, message: 'No students with outstanding balances found.' });
  }

  // Create fee assignments in the target term for each student with outstanding.
  // Idempotent: if a carry-over assignment already exists for (student,
  // outstandingFeeHead, targetTerm), skip — so re-running after a partial
  // failure won't double-create rows.
  let carriedOver = 0;
  let skipped = 0;
  for (const s of students) {
    const outstanding = Number(s.expected) - Number(s.paid);
    if (outstanding <= 0) continue;

    // Check if this student already has a carry-over assignment in the target term
    const { rows: existing } = await db.query(
      `SELECT id FROM student_fee_assignments WHERE student_id = $1 AND fee_head_id = $2 AND term_id = $3`,
      [s.id, outstandingFeeHeadId, targetTermId]
    );
    if (existing[0]) { skipped++; continue; }

    await db.query(
      `INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, discount_amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7)`,
      [randomUUID(), tenantId, s.id, outstandingFeeHeadId, targetTermId, outstanding, userId]
    );
    carriedOver++;
  }

  await recordAudit({
    tenantId, actorUserId: userId, action: 'create', entityType: 'carry_over', entityId: null,
    ipAddress: req.ip,
    metadata: { sourceTermId, sourceTermName: sourceTerm.name, targetTermId, targetTermName: targetTerm.name, carriedOver, skipped }
  });

  res.json({
    ok: true,
    carriedOver,
    skipped,
    sourceTermName: sourceTerm.name,
    targetTermName: targetTerm.name,
    message: `${carriedOver} student(s) had their outstanding balances carried over to ${targetTerm.name}.`
  });
}

// Preview — shows what WOULD be carried over without actually doing it.
// targetTermId is accepted for symmetry with POST but only used by the caller
// to decide which term to carry into; the outstanding calculation is purely
// a function of the source term.
async function previewCarryOver(req, res) {
  const { tenantId } = req.user;
  const { sourceTermId } = req.query;

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
  `, [tenantId, sourceTermId]);

  const formatted = students.map(s => ({
    studentId: s.id,
    studentName: s.name,
    class: s.class,
    expected: Number(s.expected),
    paid: Number(s.paid),
    outstanding: Number(s.expected) - Number(s.paid),
  }));

  const totalOutstanding = formatted.reduce((sum, s) => sum + s.outstanding, 0);

  res.json({
    students: formatted,
    count: formatted.length,
    totalOutstanding,
  });
}

module.exports = { carryOverOutstanding, previewCarryOver };

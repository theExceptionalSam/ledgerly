const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Payment plans — split a fee into installments with due dates and optional late fees.
//
// The plan row tracks total_amount, installments count, and how many have been paid.
// Each installment is just a row in the payments table linked by (student, fee_head,
// term) — there's no separate installments table. paid_installments is computed as
// the COUNT of payments against that (student, fee_head, term) triple, so the
// "details" endpoint derives it on the fly.

async function listPlans(req, res) {
  const { rows } = await db.query(
    `SELECT pp.id, pp.total_amount, pp.installments, pp.paid_installments, pp.late_fee, pp.status, pp.created_at,
            s.name AS student_name, s.class AS student_class, fh.name AS fee_head_name, t.name AS term_name
     FROM payment_plans pp
     JOIN students s ON s.id = pp.student_id
     JOIN fee_heads fh ON fh.id = pp.fee_head_id
     JOIN terms t ON t.id = pp.term_id
     WHERE pp.tenant_id = $1
     ORDER BY pp.created_at DESC`,
    [req.user.tenantId]
  );
  res.json({ plans: rows });
}

async function createPlan(req, res) {
  const { tenantId, id: userId } = req.user;
  const { studentId, feeHeadId, termId, totalAmount, installments, dueDates, lateFee } = req.body;

  // Verify the (student, fee_head, term) triple exists in this tenant.
  const { rows: sRows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [studentId, tenantId]);
  if (!sRows[0]) return res.status(404).json({ error: 'Student not found' });
  const { rows: fhRows } = await db.query(`SELECT id FROM fee_heads WHERE id = $1 AND tenant_id = $2 AND is_active = 1`, [feeHeadId, tenantId]);
  if (!fhRows[0]) return res.status(404).json({ error: 'Fee head not found' });
  const { rows: tRows } = await db.query(`SELECT id FROM terms WHERE id = $1 AND tenant_id = $2`, [termId, tenantId]);
  if (!tRows[0]) return res.status(404).json({ error: 'Term not found' });

  // Seed the student_fee_assignment so the plan is reflected in the student's
  // expected total — installments pay against this assignment.
  const { rows: existingAsg } = await db.query(`SELECT id FROM student_fee_assignments WHERE student_id = $1 AND fee_head_id = $2 AND term_id = $3`, [studentId, feeHeadId, termId]);
  if (!existingAsg[0]) {
    await db.query(
      `INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), tenantId, studentId, feeHeadId, termId, totalAmount, userId]
    );
  }

  const id = randomUUID();
  await db.query(
    `INSERT INTO payment_plans (id, tenant_id, student_id, fee_head_id, term_id, total_amount, installments, due_dates, late_fee, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
    [id, tenantId, studentId, feeHeadId, termId, totalAmount, installments, JSON.stringify(dueDates || []), lateFee || 0]
  );
  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'payment_plan', entityId: id, ipAddress: req.ip, metadata: { studentId, feeHeadId, termId, totalAmount, installments } });
  res.status(201).json({ id });
}

async function getPlan(req, res) {
  const { id } = req.params;
  const { rows: planRows } = await db.query(
    `SELECT pp.*, s.name AS student_name, s.class AS student_class, fh.name AS fee_head_name, t.name AS term_name
     FROM payment_plans pp
     JOIN students s ON s.id = pp.student_id
     JOIN fee_heads fh ON fh.id = pp.fee_head_id
     JOIN terms t ON t.id = pp.term_id
     WHERE pp.id = $1 AND pp.tenant_id = $2`,
    [id, req.user.tenantId]
  );
  const plan = planRows[0];
  if (!plan) return res.status(404).json({ error: 'Payment plan not found' });

  // List the installments paid so far — payments against this (student, fee_head, term).
  const { rows: payments } = await db.query(
    `SELECT id, amount, method, note, paid_on, created_at
     FROM payments
     WHERE tenant_id = $1 AND student_id = $2 AND fee_head_id = $3 AND term_id = $4 AND reversed = 0
     ORDER BY paid_on ASC`,
    [req.user.tenantId, plan.student_id, plan.fee_head_id, plan.term_id]
  );
  res.json({
    plan: {
      ...plan,
      due_dates: typeof plan.due_dates === 'string' ? JSON.parse(plan.due_dates) : plan.due_dates,
      paid_installments: payments.length,
    },
    installments: payments,
  });
}

module.exports = { listPlans, createPlan, getPlan };

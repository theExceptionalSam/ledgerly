const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Every query below is scoped by tenant_id taken from the authenticated session (req.user.tenantId),
// never from client input. This is the tenant-isolation boundary.
//
// Phase 2: billing is now per-term, per-fee-head. List/detail/dashboard calls accept ?termId=
// and default to the tenant's current term when omitted, so callers always get a sensible scope.
//
// Postgres migration note: db.query() is async (pg) and uses native $N placeholders. Every
// function that touches the db is async, and recordAudit() is awaited. recordAudit() accepts an
// optional client so audit writes can join the caller's open transaction.

async function resolveTermId(tenantId, termId) {
  if (termId) return termId;
  const { rows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
  const current = rows[0];
  return current ? current.id : null;
}

async function listStudents(req, res) {
  const { tenantId } = req.user;
  const termId = await resolveTermId(tenantId, req.query.termId);
  if (!termId) return res.json({ students: [] });

  const { rows: students } = await db.query(`
    SELECT s.id, s.name, s.class, s.admission_no, s.guardian_contact,
      COALESCE((SELECT SUM(sfa.expected_amount - sfa.discount_amount)
                FROM student_fee_assignments sfa
                WHERE sfa.student_id = s.id AND sfa.term_id = $1), 0) AS expected,
      COALESCE((SELECT SUM(p.amount)
                FROM payments p
                WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) AS paid
    FROM students s
    WHERE s.tenant_id = $3 AND s.status = 'active'
    ORDER BY s.name ASC
  `, [termId, termId, tenantId]);

  const withStatus = students.map(s => {
    const expected = Number(s.expected) || 0;
    const paid = Number(s.paid) || 0;
    const outstanding = Math.max(expected - paid, 0);
    let status = 'unset';
    if (expected > 0) {
      status = paid >= expected ? 'paid' : paid > 0 ? 'partial' : 'outstanding';
    }
    return { ...s, expected, paid, outstanding, status };
  });

  res.json({ students: withStatus });
}

async function createStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, class: klass, admissionNo, guardianContact } = req.body;

  const id = randomUUID();
  await db.query(`
    INSERT INTO students (id, tenant_id, name, class, admission_no, guardian_contact, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [id, tenantId, name, klass, admissionNo || null, guardianContact || null, userId]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.status(201).json({ id });
}

async function updateStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { name, class: klass, admissionNo, guardianContact } = req.body;

  const { rows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  await db.query(`
    UPDATE students SET name = $1, class = $2, admission_no = $3, guardian_contact = $4
    WHERE id = $5 AND tenant_id = $6
  `, [name, klass, admissionNo || null, guardianContact || null, id, tenantId]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

// Soft delete only — financial history must never be hard-deleted for audit integrity
async function archiveStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  await db.query(`UPDATE students SET status = 'archived' WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

// Bulk archive — soft-deletes multiple students in a single UPDATE. Financial history is
// preserved for each. Returns the count archived (rowCount from the bulk UPDATE).
async function bulkArchiveStudents(req, res) {
  const { tenantId, id: userId } = req.user;
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided' });
  }

  let archived = 0;
  await db.transaction(async (client) => {
    const result = await db.query(
      `UPDATE students SET status = 'archived' WHERE id = ANY($1::text[]) AND tenant_id = $2 AND status = 'active'`,
      [ids, tenantId], client
    );
    archived = result.rowCount;
  });

  if (archived > 0) {
    await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'student_bulk', ipAddress: req.ip, metadata: { archived } });
  }
  res.json({ archived });
}

async function getStudentDetail(req, res) {
  const { tenantId } = req.user;
  const { id } = req.params;
  const termId = await resolveTermId(tenantId, req.query.termId);

  const { rows: studentRows } = await db.query(`SELECT id, name, class, admission_no, guardian_contact, status, created_at FROM students WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const student = studentRows[0];
  if (!student) return res.status(404).json({ error: 'Student not found' });

  let payments = [];
  if (termId) {
    const { rows: paymentRows } = await db.query(`
        SELECT p.id, p.amount, p.method, p.note, p.paid_on, p.fee_head_id, p.term_id, p.created_at, fh.name AS fee_head_name
        FROM payments p LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
        WHERE p.student_id = $1 AND p.tenant_id = $2 AND p.term_id = $3 AND p.reversed = 0
        ORDER BY p.paid_on DESC
    `, [id, tenantId, termId]);
    payments = paymentRows;
  }

  const fees = termId ? await getStudentFeesInternal(tenantId, id, termId) : [];

  // No audit entry for `action: 'access'` — auditing every student detail view bloats the
  // audit log and the query is already scoped by tenant_id.
  res.json({ student, payments, fees, termId });
}

// --- Phase 2: itemised fee assignments ---

async function getStudentFeesInternal(tenantId, studentId, termId) {
  const { rows } = await db.query(`
    SELECT sfa.id, sfa.fee_head_id, sfa.term_id, sfa.expected_amount, sfa.discount_amount,
           sfa.discount_reason, fh.name AS fee_head_name,
           COALESCE((SELECT SUM(p.amount) FROM payments p
                     WHERE p.student_id = sfa.student_id AND p.fee_head_id = sfa.fee_head_id
                       AND p.term_id = sfa.term_id AND p.reversed = 0), 0) AS paid
    FROM student_fee_assignments sfa
    JOIN fee_heads fh ON fh.id = sfa.fee_head_id
    WHERE sfa.tenant_id = $1 AND sfa.student_id = $2 AND sfa.term_id = $3
    ORDER BY fh.name
  `, [tenantId, studentId, termId]);
  return rows.map(a => ({
    ...a,
    outstanding: Math.max(a.expected_amount - a.discount_amount - a.paid, 0),
  }));
}

async function getStudentFees(req, res) {
  const { tenantId } = req.user;
  const { id } = req.params;
  const termId = await resolveTermId(tenantId, req.query.termId);
  if (!termId) return res.json({ fees: [] });

  const { rows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const student = rows[0];
  if (!student) return res.status(404).json({ error: 'Student not found' });

  res.json({ fees: await getStudentFeesInternal(tenantId, id, termId) });
}

async function assignStudentFee(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: studentId } = req.params;
  const { feeHeadId, termId, expectedAmount } = req.body;

  const { rows: studentRows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [studentId, tenantId]);
  const student = studentRows[0];
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const { rows: headRows } = await db.query(`SELECT id FROM fee_heads WHERE id = $1 AND tenant_id = $2 AND is_active = 1`, [feeHeadId, tenantId]);
  const head = headRows[0];
  if (!head) return res.status(404).json({ error: 'Fee head not found' });

  const { rows: termRows } = await db.query(`SELECT id FROM terms WHERE id = $1 AND tenant_id = $2`, [termId, tenantId]);
  const term = termRows[0];
  if (!term) return res.status(404).json({ error: 'Term not found' });

  // Upsert: insert, or update expected_amount if the (student, head, term) row already exists.
  const { rows: existingRows } = await db.query(`SELECT id FROM student_fee_assignments WHERE student_id = $1 AND fee_head_id = $2 AND term_id = $3`, [studentId, feeHeadId, termId]);
  const existing = existingRows[0];
  let assignmentId;
  if (existing) {
    await db.query(`UPDATE student_fee_assignments SET expected_amount = $1 WHERE id = $2`, [expectedAmount, existing.id]);
    assignmentId = existing.id;
  } else {
    assignmentId = randomUUID();
    await db.query(`
      INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [assignmentId, tenantId, studentId, feeHeadId, termId, expectedAmount, userId]);
  }

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'fee_assignment', entityId: assignmentId, ipAddress: req.ip, metadata: { studentId, feeHeadId, termId, expectedAmount } });
  res.status(201).json({ id: assignmentId });
}

async function applyDiscount(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: studentId, assignmentId } = req.params;
  const { discountAmount, discountReason } = req.body;

  const { rows: assignmentRows } = await db.query(`
    SELECT sfa.id FROM student_fee_assignments sfa
    JOIN students s ON s.id = sfa.student_id
    WHERE sfa.id = $1 AND sfa.student_id = $2 AND sfa.tenant_id = $3
  `, [assignmentId, studentId, tenantId]);
  const assignment = assignmentRows[0];
  if (!assignment) return res.status(404).json({ error: 'Fee assignment not found' });

  await db.query(`
    UPDATE student_fee_assignments
    SET discount_amount = $1, discount_reason = $2, discount_approved_by = $3
    WHERE id = $4
  `, [discountAmount, discountReason || null, userId, assignmentId]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'discount', entityId: assignmentId, ipAddress: req.ip, metadata: { studentId, discountAmount, discountReason } });
  res.json({ ok: true });
}

module.exports = { listStudents, createStudent, updateStudent, archiveStudent, bulkArchiveStudents, getStudentDetail, getStudentFees, assignStudentFee, applyDiscount };

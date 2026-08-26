const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Every query below is scoped by tenant_id taken from the authenticated session (req.user.tenantId),
// never from client input. This is the tenant-isolation boundary.
//
// Phase 2: billing is now per-term, per-fee-head. List/detail/dashboard calls accept ?termId=
// and default to the tenant's current term when omitted, so callers always get a sensible scope.

function resolveTermId(tenantId, termId) {
  if (termId) return termId;
  const current = db.prepare(`SELECT id FROM terms WHERE tenant_id = ? AND is_current = 1`).get(tenantId);
  return current ? current.id : null;
}

function listStudents(req, res) {
  const { tenantId } = req.user;
  const termId = resolveTermId(tenantId, req.query.termId);
  if (!termId) return res.json({ students: [] });

  const students = db.prepare(`
    SELECT s.id, s.name, s.class, s.admission_no, s.guardian_contact,
      COALESCE((SELECT SUM(sfa.expected_amount - sfa.discount_amount)
                FROM student_fee_assignments sfa
                WHERE sfa.student_id = s.id AND sfa.term_id = ?), 0) AS expected,
      COALESCE((SELECT SUM(p.amount)
                FROM payments p
                WHERE p.student_id = s.id AND p.term_id = ? AND p.reversed = 0), 0) AS paid
    FROM students s
    WHERE s.tenant_id = ? AND s.status = 'active'
    ORDER BY s.name ASC
  `).all(termId, termId, tenantId);

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

function createStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, class: klass, admissionNo, guardianContact } = req.body;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO students (id, tenant_id, name, class, admission_no, guardian_contact, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, name, klass, admissionNo || null, guardianContact || null, userId);

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.status(201).json({ id });
}

function updateStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { name, class: klass, admissionNo, guardianContact } = req.body;

  const existing = db.prepare(`SELECT id FROM students WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  db.prepare(`
    UPDATE students SET name = ?, class = ?, admission_no = ?, guardian_contact = ?
    WHERE id = ? AND tenant_id = ?
  `).run(name, klass, admissionNo || null, guardianContact || null, id, tenantId);

  recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

// Soft delete only — financial history must never be hard-deleted for audit integrity
function archiveStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const existing = db.prepare(`SELECT id FROM students WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  db.prepare(`UPDATE students SET status = 'archived' WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
  recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

function getStudentDetail(req, res) {
  const { tenantId } = req.user;
  const { id } = req.params;
  const termId = resolveTermId(tenantId, req.query.termId);

  const student = db.prepare(`SELECT id, name, class, admission_no, guardian_contact, status, created_at FROM students WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const payments = termId
    ? db.prepare(`
        SELECT p.id, p.amount, p.method, p.note, p.paid_on, p.fee_head_id, p.term_id, p.created_at, fh.name AS fee_head_name
        FROM payments p LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
        WHERE p.student_id = ? AND p.tenant_id = ? AND p.term_id = ? AND p.reversed = 0
        ORDER BY p.paid_on DESC
      `).all(id, tenantId, termId)
    : [];

  const fees = termId ? getStudentFeesInternal(tenantId, id, termId) : [];

  recordAudit({ tenantId, actorUserId: req.user.id, action: 'access', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.json({ student, payments, fees, termId });
}

// --- Phase 2: itemised fee assignments ---

function getStudentFeesInternal(tenantId, studentId, termId) {
  return db.prepare(`
    SELECT sfa.id, sfa.fee_head_id, sfa.term_id, sfa.expected_amount, sfa.discount_amount,
           sfa.discount_reason, fh.name AS fee_head_name,
           COALESCE((SELECT SUM(p.amount) FROM payments p
                     WHERE p.student_id = sfa.student_id AND p.fee_head_id = sfa.fee_head_id
                       AND p.term_id = sfa.term_id AND p.reversed = 0), 0) AS paid
    FROM student_fee_assignments sfa
    JOIN fee_heads fh ON fh.id = sfa.fee_head_id
    WHERE sfa.tenant_id = ? AND sfa.student_id = ? AND sfa.term_id = ?
    ORDER BY fh.name
  `).all(tenantId, studentId, termId).map(a => ({
    ...a,
    outstanding: Math.max(a.expected_amount - a.discount_amount - a.paid, 0),
  }));
}

function getStudentFees(req, res) {
  const { tenantId } = req.user;
  const { id } = req.params;
  const termId = resolveTermId(tenantId, req.query.termId);
  if (!termId) return res.json({ fees: [] });

  const student = db.prepare(`SELECT id FROM students WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  res.json({ fees: getStudentFeesInternal(tenantId, id, termId) });
}

function assignStudentFee(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: studentId } = req.params;
  const { feeHeadId, termId, expectedAmount } = req.body;

  const student = db.prepare(`SELECT id FROM students WHERE id = ? AND tenant_id = ? AND status = 'active'`).get(studentId, tenantId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const head = db.prepare(`SELECT id FROM fee_heads WHERE id = ? AND tenant_id = ? AND is_active = 1`).get(feeHeadId, tenantId);
  if (!head) return res.status(404).json({ error: 'Fee head not found' });

  const term = db.prepare(`SELECT id FROM terms WHERE id = ? AND tenant_id = ?`).get(termId, tenantId);
  if (!term) return res.status(404).json({ error: 'Term not found' });

  // Upsert: insert, or update expected_amount if the (student, head, term) row already exists.
  const existing = db.prepare(`SELECT id FROM student_fee_assignments WHERE student_id = ? AND fee_head_id = ? AND term_id = ?`).get(studentId, feeHeadId, termId);
  let assignmentId;
  if (existing) {
    db.prepare(`UPDATE student_fee_assignments SET expected_amount = ? WHERE id = ?`).run(expectedAmount, existing.id);
    assignmentId = existing.id;
  } else {
    assignmentId = randomUUID();
    db.prepare(`
      INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(assignmentId, tenantId, studentId, feeHeadId, termId, expectedAmount, userId);
  }

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'fee_assignment', entityId: assignmentId, ipAddress: req.ip, metadata: { studentId, feeHeadId, termId, expectedAmount } });
  res.status(201).json({ id: assignmentId });
}

function applyDiscount(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: studentId, assignmentId } = req.params;
  const { discountAmount, discountReason } = req.body;

  const assignment = db.prepare(`
    SELECT sfa.id FROM student_fee_assignments sfa
    JOIN students s ON s.id = sfa.student_id
    WHERE sfa.id = ? AND sfa.student_id = ? AND sfa.tenant_id = ?
  `).get(assignmentId, studentId, tenantId);
  if (!assignment) return res.status(404).json({ error: 'Fee assignment not found' });

  db.prepare(`
    UPDATE student_fee_assignments
    SET discount_amount = ?, discount_reason = ?, discount_approved_by = ?
    WHERE id = ?
  `).run(discountAmount, discountReason || null, userId, assignmentId);

  recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'discount', entityId: assignmentId, ipAddress: req.ip, metadata: { studentId, discountAmount, discountReason } });
  res.json({ ok: true });
}

module.exports = { listStudents, createStudent, updateStudent, archiveStudent, getStudentDetail, getStudentFees, assignStudentFee, applyDiscount };

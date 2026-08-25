const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Every query below is scoped by tenant_id taken from the authenticated session (req.user.tenantId),
// never from client input. This is the tenant-isolation boundary.

function listStudents(req, res) {
  const { tenantId } = req.user;
  const students = db.prepare(`
    SELECT s.*,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.student_id = s.id AND p.reversed = 0), 0) AS paid
    FROM students s
    WHERE s.tenant_id = ? AND s.status = 'active'
    ORDER BY s.name ASC
  `).all(tenantId);

  const withStatus = students.map(s => {
    const outstanding = Math.max(s.fee_amount - s.paid, 0);
    let status = 'unset';
    if (s.fee_amount > 0) {
      status = s.paid >= s.fee_amount ? 'paid' : s.paid > 0 ? 'partial' : 'outstanding';
    }
    return { ...s, outstanding, status };
  });

  res.json({ students: withStatus });
}

function createStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, class: klass, admissionNo, feeAmount, guardianContact } = req.body;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO students (id, tenant_id, name, class, admission_no, guardian_contact, fee_amount, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, name, klass, admissionNo || null, guardianContact || null, feeAmount, userId);

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.status(201).json({ id });
}

function updateStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { name, class: klass, admissionNo, feeAmount, guardianContact } = req.body;

  const existing = db.prepare(`SELECT id FROM students WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  db.prepare(`
    UPDATE students SET name = ?, class = ?, admission_no = ?, guardian_contact = ?, fee_amount = ?
    WHERE id = ? AND tenant_id = ?
  `).run(name, klass, admissionNo || null, guardianContact || null, feeAmount, id, tenantId);

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

  const student = db.prepare(`SELECT * FROM students WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const payments = db.prepare(`
    SELECT id, amount, method, note, paid_on, created_at FROM payments
    WHERE student_id = ? AND tenant_id = ? AND reversed = 0
    ORDER BY paid_on DESC
  `).all(id, tenantId);

  recordAudit({ tenantId, actorUserId: req.user.id, action: 'access', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.json({ student, payments });
}

module.exports = { listStudents, createStudent, updateStudent, archiveStudent, getStudentDetail };

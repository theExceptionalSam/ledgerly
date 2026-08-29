const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signParentToken } = require('../utils/tokens');
const { recordAudit } = require('../utils/audit');

// Parent portal — a parallel auth surface for parents (not staff).
//
// Parents register with their phone + a password and link to one or more students
// (the student's guardian_contact must match the parent's phone, enforced here).
// Auth tokens are a SEPARATE type ('parent') so a parent token can't be used on
// staff endpoints — see middleware/auth.js requireAuth/requireParent.

const REFRESH_COOKIE = 'parent_refresh_token';

async function register(req, res) {
  const { phone, name, password, studentId } = req.body;

  // Look up the student first — we need its tenant_id to scope the parent account.
  // The student's guardian_contact must match the parent's phone, otherwise anyone
  // could claim any student by ID.
  const { rows: studentRows } = await db.query(
    `SELECT id, tenant_id, guardian_contact, name FROM students WHERE id = $1 AND status = 'active'`,
    [studentId]
  );
  const student = studentRows[0];
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (!student.guardian_contact || student.guardian_contact.replace(/\s+/g, '') !== phone.replace(/\s+/g, '')) {
    return res.status(403).json({ error: 'This phone number is not registered as a guardian for this student' });
  }

  // Idempotent: if a parent already exists for (tenant, phone), reuse it.
  const { rows: existingRows } = await db.query(`SELECT id FROM parents WHERE tenant_id = $1 AND phone = $2`, [student.tenant_id, phone]);
  let parentId;
  if (existingRows[0]) {
    parentId = existingRows[0].id;
    // Update password + name if re-registering.
    const passwordHash = await bcrypt.hash(password, 12);
    await db.query(`UPDATE parents SET password_hash = $1, name = $2 WHERE id = $3`, [passwordHash, name, parentId]);
  } else {
    parentId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    await db.query(
      `INSERT INTO parents (id, tenant_id, phone, name, password_hash) VALUES ($1, $2, $3, $4, $5)`,
      [parentId, student.tenant_id, phone, name, passwordHash]
    );
  }

  // Link parent → student (UNIQUE constraint dedupes if already linked).
  await db.query(
    `INSERT INTO parent_students (id, parent_id, student_id) VALUES ($1, $2, $3)
     ON CONFLICT (parent_id, student_id) DO NOTHING`,
    [randomUUID(), parentId, studentId]
  );

  await recordAudit({ tenantId: student.tenant_id, actorUserId: null, action: 'create', entityType: 'parent', entityId: parentId, ipAddress: req.ip, metadata: { phone, studentId } });
  res.status(201).json({ id: parentId });
}

async function login(req, res) {
  const { phone, password } = req.body;
  const { rows } = await db.query(`SELECT * FROM parents WHERE phone = $1`, [phone]);
  const parent = rows[0];
  if (!parent) return res.status(401).json({ error: 'Incorrect phone or password' });

  const valid = parent.password_hash && await bcrypt.compare(password, parent.password_hash);
  if (!valid) return res.status(401).json({ error: 'Incorrect phone or password' });

  const accessToken = signParentToken({ id: parent.id, tenant_id: parent.tenant_id });
  res.json({ accessToken, parent: { id: parent.id, phone: parent.phone, name: parent.name, tenantId: parent.tenant_id } });
}

async function me(req, res) {
  const { rows: parentRows } = await db.query(`SELECT id, phone, name, email, tenant_id, created_at FROM parents WHERE id = $1`, [req.parent.id]);
  const parent = parentRows[0];
  if (!parent) return res.status(404).json({ error: 'Parent not found' });

  const { rows: students } = await db.query(
    `SELECT s.id, s.name, s.class, s.admission_no, s.tenant_id, t.name AS school_name
     FROM parent_students ps
     JOIN students s ON s.id = ps.student_id
     JOIN tenants t ON t.id = s.tenant_id
     WHERE ps.parent_id = $1 AND s.status = 'active'`,
    [parent.id]
  );
  res.json({ parent: { id: parent.id, phone: parent.phone, name: parent.name, email: parent.email, tenantId: parent.tenant_id, createdAt: parent.created_at }, students });
}

// Link an additional child to an already-authenticated parent's account.
// Accepts either a studentId (UUID) or an admissionNo (looked up across ALL
// tenants — allows a parent to link children in different schools).
// The parent's phone must match the student's guardian_contact.
async function linkChild(req, res) {
  const { studentId, admissionNo } = req.body;
  const { id: parentId } = req.parent;

  // Look up the parent's phone from the DB.
  const { rows: parentRows } = await db.query(`SELECT phone FROM parents WHERE id = $1`, [parentId]);
  const parentPhone = parentRows[0]?.phone;
  if (!parentPhone) return res.status(404).json({ error: 'Parent account not found' });

  let lookupField, lookupValue;
  if (studentId) {
    lookupField = 'id';
    lookupValue = studentId;
  } else if (admissionNo) {
    lookupField = 'admission_no';
    lookupValue = admissionNo.trim();
  } else {
    return res.status(400).json({ error: 'Provide studentId or admissionNo' });
  }

  // Search across ALL tenants — a parent may have children in different schools.
  const { rows: studentRows } = await db.query(
    `SELECT id, tenant_id, guardian_contact, name, admission_no FROM students WHERE ${lookupField} = $1 AND status = 'active'`,
    [lookupValue]
  );
  const student = studentRows[0];
  if (!student) return res.status(404).json({ error: 'Student not found. Check the admission number and try again.' });
  if (!student.guardian_contact || student.guardian_contact.replace(/\s+/g, '') !== parentPhone.replace(/\s+/g, '')) {
    return res.status(403).json({ error: 'This phone number is not registered as a guardian for this student. Contact the school to update your child\'s guardian contact.' });
  }

  // Link (UNIQUE constraint dedupes if already linked).
  await db.query(
    `INSERT INTO parent_students (id, parent_id, student_id) VALUES ($1, $2, $3)
     ON CONFLICT (parent_id, student_id) DO NOTHING`,
    [randomUUID(), parentId, student.id]
  );

  await recordAudit({ tenantId: student.tenant_id, actorUserId: null, action: 'create', entityType: 'parent', entityId: parentId, ipAddress: req.ip, metadata: { action: 'link_child', studentId: student.id, studentName: student.name } });
  res.json({ ok: true, studentName: student.name });
}

async function studentFees(req, res) {
  const { id: studentId } = req.params;
  // Verify this parent is linked to the student.
  const { rows: linkRows } = await db.query(`SELECT 1 FROM parent_students WHERE parent_id = $1 AND student_id = $2`, [req.parent.id, studentId]);
  if (!linkRows[0]) return res.status(403).json({ error: 'You are not linked to this student' });

  // Look up the student's actual tenant — the parent may have children in
  // different schools, so we can't use req.parent.tenantId here.
  const { rows: studentRows } = await db.query(`SELECT tenant_id FROM students WHERE id = $1`, [studentId]);
  const studentTenantId = studentRows[0]?.tenant_id;
  if (!studentTenantId) return res.status(404).json({ error: 'Student not found' });

  const { rows: termRows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [studentTenantId]);
  const termId = termRows[0]?.id;
  if (!termId) return res.json({ fees: [] });

  const { rows } = await db.query(
    `SELECT sfa.id, sfa.fee_head_id, sfa.expected_amount, sfa.discount_amount, sfa.discount_reason, fh.name AS fee_head_name,
            COALESCE((SELECT SUM(p.amount) FROM payments p
                      WHERE p.student_id = sfa.student_id AND p.fee_head_id = sfa.fee_head_id AND p.term_id = sfa.term_id AND p.reversed = 0), 0) AS paid
     FROM student_fee_assignments sfa
     JOIN fee_heads fh ON fh.id = sfa.fee_head_id
     WHERE sfa.tenant_id = $1 AND sfa.student_id = $2 AND sfa.term_id = $3
     ORDER BY fh.name`,
    [studentTenantId, studentId, termId]
  );
  const fees = rows.map((a) => ({ ...a, outstanding: Math.max(a.expected_amount - a.discount_amount - a.paid, 0) }));
  res.json({ fees });
}

async function studentPayments(req, res) {
  const { id: studentId } = req.params;
  const { rows: linkRows } = await db.query(`SELECT 1 FROM parent_students WHERE parent_id = $1 AND student_id = $2`, [req.parent.id, studentId]);
  if (!linkRows[0]) return res.status(403).json({ error: 'You are not linked to this student' });

  // Look up the student's actual tenant (may differ from parent's home tenant).
  const { rows: studentRows } = await db.query(`SELECT tenant_id FROM students WHERE id = $1`, [studentId]);
  const studentTenantId = studentRows[0]?.tenant_id;
  if (!studentTenantId) return res.status(404).json({ error: 'Student not found' });

  const { rows } = await db.query(
    `SELECT p.id, p.amount, p.method, p.note, p.paid_on, p.created_at, fh.name AS fee_head_name, t.name AS term_name
     FROM payments p
     LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
     LEFT JOIN terms t ON t.id = p.term_id
     WHERE p.tenant_id = $1 AND p.student_id = $2 AND p.reversed = 0
     ORDER BY p.paid_on DESC
     LIMIT 200`,
    [studentTenantId, studentId]
  );
  res.json({ payments: rows });
}

// Parent-scoped receipt download. Verifies the parent is linked to the
// student who made the payment, then delegates to the same issueReceipt
// logic used by the staff endpoint. Uses the payment's actual tenant_id
// (not the parent's home tenant) so it works across schools.
async function downloadReceipt(req, res) {
  const { paymentId } = req.params;
  const { id: parentId } = req.parent;

  // Verify the payment belongs to a student linked to this parent.
  // Don't filter by tenant_id here — the payment may be in a different school.
  const { rows: payRows } = await db.query(
    `SELECT p.student_id, p.tenant_id FROM payments p
     JOIN parent_students ps ON ps.student_id = p.student_id
     WHERE p.id = $1 AND ps.parent_id = $2 AND p.reversed = 0`,
    [paymentId, parentId]
  );
  if (!payRows[0]) return res.status(404).json({ error: 'Payment not found or not linked to your account' });

  // Use the payment's actual tenant_id — the parent may have children in
  // different schools, so we can't use req.parent.tenantId.
  const receiptsCtrl = require('./receipts.controller');
  req.user = { tenantId: payRows[0].tenant_id, id: null, role: 'parent' };
  return receiptsCtrl.issueReceipt(req, res);
}

module.exports = { register, login, me, linkChild, studentFees, studentPayments, downloadReceipt };

const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Phase 2: every payment is recorded against a specific fee head and term.
// fee_head_id is required (enforced here, not at the column level, since SQLite
// cannot add a NOT NULL column with no default to an existing table). term_id
// defaults to the tenant's current term if not provided.
//
// Postgres migration note: db.query() is async (pg) and uses native $N placeholders.
// recordPayment wraps the INSERT and the audit row in a single transaction so a
// crash between them can never leave an unaudited payment. recordAudit() is
// passed the transaction client as its 2nd argument.

async function recordPayment(req, res) {
  const { tenantId, id: userId } = req.user;
  const { studentId, amount, method, note, paidOn, idempotencyKey, feeHeadId, termId } = req.body;

  if (!feeHeadId) {
    return res.status(400).json({ error: 'feeHeadId is required — every payment must be recorded against a specific fee head' });
  }

  const { rows: studentRows } = await db.query(`SELECT id, name FROM students WHERE id = $1 AND tenant_id = $2`, [studentId, tenantId]);
  const student = studentRows[0];
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const { rows: headRows } = await db.query(`SELECT id, name FROM fee_heads WHERE id = $1 AND tenant_id = $2 AND is_active = 1`, [feeHeadId, tenantId]);
  const head = headRows[0];
  if (!head) return res.status(404).json({ error: 'Fee head not found' });

  // Resolve term: use the provided one, or default to the tenant's current term.
  let resolvedTermId = termId;
  if (!resolvedTermId) {
    const { rows: currentRows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
    const current = currentRows[0];
    if (!current) return res.status(400).json({ error: 'No current term set — create a term first' });
    resolvedTermId = current.id;
  } else {
    const { rows: termRows } = await db.query(`SELECT id FROM terms WHERE id = $1 AND tenant_id = $2`, [resolvedTermId, tenantId]);
    const term = termRows[0];
    if (!term) return res.status(404).json({ error: 'Term not found' });
  }

  // Idempotency: if this key was already used for this tenant, return the original result
  // instead of creating a duplicate payment (protects against double-tap / retried requests)
  if (idempotencyKey) {
    const { rows: dupeRows } = await db.query(`SELECT id FROM payments WHERE tenant_id = $1 AND idempotency_key = $2`, [tenantId, idempotencyKey]);
    const dupe = dupeRows[0];
    if (dupe) return res.status(200).json({ id: dupe.id, deduplicated: true });
  }

  const id = randomUUID();
  // Insert the payment row and the audit-log row in a single transaction. If either
  // write fails, both are rolled back — no unaudited payments can ever be persisted.
  await db.transaction(async (client) => {
    await db.query(`
      INSERT INTO payments (id, tenant_id, student_id, amount, method, note, paid_on, recorded_by, idempotency_key, fee_head_id, term_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [id, tenantId, studentId, amount, method || 'cash', note || null, paidOn, userId, idempotencyKey || null, feeHeadId, resolvedTermId], client);

    await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'payment', entityId: id, ipAddress: req.ip, metadata: { studentName: student.name, feeHeadName: head.name, amount, method: method || 'cash' } }, client);
  });

  res.status(201).json({ id });
}

// Payments are never edited or hard-deleted once recorded — a correction is a reversing entry,
// so the ledger always reflects what actually happened and stays auditable.
async function reversePayment(req, res) {
  const { tenantId, id: userId, role } = req.user;
  const { id } = req.params;
  const { reason } = req.body;

  if (!['owner', 'accountant'].includes(role)) {
    return res.status(403).json({ error: 'Only an owner or accountant can reverse a payment' });
  }

  const { rows: paymentRows } = await db.query(`SELECT * FROM payments WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const payment = paymentRows[0];
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.reversed) return res.status(400).json({ error: 'Payment already reversed' });

  await db.query(`UPDATE payments SET reversed = 1 WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'payment', entityId: id, ipAddress: req.ip, metadata: { reversed: true, reason } });
  res.json({ ok: true });
}

module.exports = { recordPayment, reversePayment };

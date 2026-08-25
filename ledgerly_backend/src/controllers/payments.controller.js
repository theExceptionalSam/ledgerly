const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

function recordPayment(req, res) {
  const { tenantId, id: userId } = req.user;
  const { studentId, amount, method, note, paidOn, idempotencyKey } = req.body;

  const student = db.prepare(`SELECT id FROM students WHERE id = ? AND tenant_id = ?`).get(studentId, tenantId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  // Idempotency: if this key was already used for this tenant, return the original result
  // instead of creating a duplicate payment (protects against double-tap / retried requests)
  if (idempotencyKey) {
    const dupe = db.prepare(`SELECT id FROM payments WHERE tenant_id = ? AND idempotency_key = ?`).get(tenantId, idempotencyKey);
    if (dupe) return res.status(200).json({ id: dupe.id, deduplicated: true });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO payments (id, tenant_id, student_id, amount, method, note, paid_on, recorded_by, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, studentId, amount, method || 'cash', note || null, paidOn, userId, idempotencyKey || null);

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'payment', entityId: id, ipAddress: req.ip, metadata: { studentId, amount } });
  res.status(201).json({ id });
}

// Payments are never edited or hard-deleted once recorded — a correction is a reversing entry,
// so the ledger always reflects what actually happened and stays auditable.
function reversePayment(req, res) {
  const { tenantId, id: userId, role } = req.user;
  const { id } = req.params;
  const { reason } = req.body;

  if (!['owner', 'accountant'].includes(role)) {
    return res.status(403).json({ error: 'Only an owner or accountant can reverse a payment' });
  }

  const payment = db.prepare(`SELECT * FROM payments WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.reversed) return res.status(400).json({ error: 'Payment already reversed' });

  db.prepare(`UPDATE payments SET reversed = 1 WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
  recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'payment', entityId: id, ipAddress: req.ip, metadata: { reversed: true, reason } });
  res.json({ ok: true });
}

module.exports = { recordPayment, reversePayment };

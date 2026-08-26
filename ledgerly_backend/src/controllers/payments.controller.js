const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Phase 2: every payment is recorded against a specific fee head and term.
// fee_head_id is required (enforced here, not at the column level, since SQLite
// cannot add a NOT NULL column with no default to an existing table). term_id
// defaults to the tenant's current term if not provided.

function recordPayment(req, res) {
  const { tenantId, id: userId } = req.user;
  const { studentId, amount, method, note, paidOn, idempotencyKey, feeHeadId, termId } = req.body;

  if (!feeHeadId) {
    return res.status(400).json({ error: 'feeHeadId is required — every payment must be recorded against a specific fee head' });
  }

  const student = db.prepare(`SELECT id FROM students WHERE id = ? AND tenant_id = ?`).get(studentId, tenantId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const head = db.prepare(`SELECT id FROM fee_heads WHERE id = ? AND tenant_id = ? AND is_active = 1`).get(feeHeadId, tenantId);
  if (!head) return res.status(404).json({ error: 'Fee head not found' });

  // Resolve term: use the provided one, or default to the tenant's current term.
  let resolvedTermId = termId;
  if (!resolvedTermId) {
    const current = db.prepare(`SELECT id FROM terms WHERE tenant_id = ? AND is_current = 1`).get(tenantId);
    if (!current) return res.status(400).json({ error: 'No current term set — create a term first' });
    resolvedTermId = current.id;
  } else {
    const term = db.prepare(`SELECT id FROM terms WHERE id = ? AND tenant_id = ?`).get(resolvedTermId, tenantId);
    if (!term) return res.status(404).json({ error: 'Term not found' });
  }

  // Idempotency: if this key was already used for this tenant, return the original result
  // instead of creating a duplicate payment (protects against double-tap / retried requests)
  if (idempotencyKey) {
    const dupe = db.prepare(`SELECT id FROM payments WHERE tenant_id = ? AND idempotency_key = ?`).get(tenantId, idempotencyKey);
    if (dupe) return res.status(200).json({ id: dupe.id, deduplicated: true });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO payments (id, tenant_id, student_id, amount, method, note, paid_on, recorded_by, idempotency_key, fee_head_id, term_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, studentId, amount, method || 'cash', note || null, paidOn, userId, idempotencyKey || null, feeHeadId, resolvedTermId);

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'payment', entityId: id, ipAddress: req.ip, metadata: { studentId, amount, feeHeadId, termId: resolvedTermId } });
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

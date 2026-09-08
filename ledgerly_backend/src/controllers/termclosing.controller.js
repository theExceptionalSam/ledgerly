const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('./notifications.controller');

// Term closing — once a term is closed, no new payments or fee assignments can
// be recorded against it. This protects historical financials from being edited
// after the books are settled.
//
// The closed_at/closed_by columns were added in migration 017 (both TEXT —
// closed_at stores now()::text). The actual payment-blocking check lives in
// payments.controller.recordPayment and students.controller.assignStudentFee.
//
// Both close and reopen are owner-only — closing is a financial control that
// only the school owner should trigger, and reopening a closed term (which
// re-opens the books) requires owner oversight plus a documented reason.

async function closeTerm(req, res) {
  const { id } = req.params;
  const { tenantId, id: userId, role } = req.user;
  if (role !== 'owner') return res.status(403).json({ error: 'Only an owner can close a term' });

  const { rows } = await db.query(`SELECT id, name, closed_at FROM terms WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const term = rows[0];
  if (!term) return res.status(404).json({ error: 'Term not found' });
  if (term.closed_at) return res.status(400).json({ error: 'Term is already closed' });

  await db.query(`UPDATE terms SET closed_at = now()::text, closed_by = $1 WHERE id = $2 AND tenant_id = $3`, [userId, id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'term', entityId: id, ipAddress: req.ip, metadata: { closed: true, name: term.name } });

  // Notify all staff that the term is closed — anyone trying to backdate a payment
  // will need it reopened by an owner.
  const { rows: staff } = await db.query(`SELECT id FROM users WHERE tenant_id = $1 AND status = 'active'`, [tenantId]);
  for (const u of staff) {
    await createNotification(tenantId, u.id, 'term_closed', `Term closed: ${term.name}`,
      `"${term.name}" has been closed. New payments cannot be recorded against it.`, 'term', id);
  }

  res.json({ ok: true });
}

async function reopenTerm(req, res) {
  const { id } = req.params;
  const { tenantId, id: userId, role } = req.user;
  if (role !== 'owner') return res.status(403).json({ error: 'Only an owner can reopen a closed term' });

  const { reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required to reopen a closed term' });
  }

  const { rows } = await db.query(`SELECT id, name, closed_at FROM terms WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const term = rows[0];
  if (!term) return res.status(404).json({ error: 'Term not found' });
  if (!term.closed_at) return res.status(400).json({ error: 'Term is not closed' });

  await db.query(`UPDATE terms SET closed_at = NULL, closed_by = NULL WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'term', entityId: id, ipAddress: req.ip, metadata: { reopened: true, name: term.name, reason: String(reason).trim() } });
  res.json({ ok: true });
}

module.exports = { closeTerm, reopenTerm };

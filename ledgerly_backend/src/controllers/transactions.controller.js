const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

function listTransactions(req, res) {
  const { tenantId } = req.user;
  const { type } = req.query;

  const rows = type && ['income', 'expense'].includes(type)
    ? db.prepare(`SELECT * FROM transactions WHERE tenant_id = ? AND type = ? AND reversed = 0 ORDER BY occurred_on DESC`).all(tenantId, type)
    : db.prepare(`SELECT * FROM transactions WHERE tenant_id = ? AND reversed = 0 ORDER BY occurred_on DESC`).all(tenantId);

  res.json({ transactions: rows });
}

function createTransaction(req, res) {
  const { tenantId, id: userId } = req.user;
  const { type, category, amount, description, occurredOn } = req.body;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO transactions (id, tenant_id, type, category, amount, description, occurred_on, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, type, category, amount, description || null, occurredOn, userId);

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'transaction', entityId: id, ipAddress: req.ip });
  res.status(201).json({ id });
}

function reverseTransaction(req, res) {
  const { tenantId, id: userId, role } = req.user;
  const { id } = req.params;

  if (!['owner', 'accountant'].includes(role)) {
    return res.status(403).json({ error: 'Only an owner or accountant can remove an entry' });
  }

  const tx = db.prepare(`SELECT id FROM transactions WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!tx) return res.status(404).json({ error: 'Entry not found' });

  db.prepare(`UPDATE transactions SET reversed = 1 WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
  recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'transaction', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

module.exports = { listTransactions, createTransaction, reverseTransaction };

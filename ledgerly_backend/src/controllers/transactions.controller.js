const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Postgres migration note: db.query() is async (pg) and auto-converts ? placeholders
// to $N, so the existing SQL strings are kept as-is. recordAudit() is awaited.

async function listTransactions(req, res) {
  const { tenantId } = req.user;
  const { type } = req.query;

  let rows;
  if (type && ['income', 'expense'].includes(type)) {
    const result = await db.query(`SELECT * FROM transactions WHERE tenant_id = ? AND type = ? AND reversed = 0 ORDER BY occurred_on DESC`, [tenantId, type]);
    rows = result.rows;
  } else {
    const result = await db.query(`SELECT * FROM transactions WHERE tenant_id = ? AND reversed = 0 ORDER BY occurred_on DESC`, [tenantId]);
    rows = result.rows;
  }

  res.json({ transactions: rows });
}

async function createTransaction(req, res) {
  const { tenantId, id: userId } = req.user;
  const { type, category, amount, description, occurredOn } = req.body;

  const id = randomUUID();
  await db.query(`
    INSERT INTO transactions (id, tenant_id, type, category, amount, description, occurred_on, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, tenantId, type, category, amount, description || null, occurredOn, userId]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'transaction', entityId: id, ipAddress: req.ip });
  res.status(201).json({ id });
}

async function reverseTransaction(req, res) {
  const { tenantId, id: userId, role } = req.user;
  const { id } = req.params;

  if (!['owner', 'accountant'].includes(role)) {
    return res.status(403).json({ error: 'Only an owner or accountant can remove an entry' });
  }

  const { rows } = await db.query(`SELECT id FROM transactions WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  const tx = rows[0];
  if (!tx) return res.status(404).json({ error: 'Entry not found' });

  await db.query(`UPDATE transactions SET reversed = 1 WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'transaction', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

module.exports = { listTransactions, createTransaction, reverseTransaction };

const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Income/expenditure transactions are term-scoped. listTransactions accepts
// ?termId= and filters by it; createTransaction accepts termId in the body and
// defaults to the tenant's current term if omitted.

async function resolveTermId(tenantId, termId) {
  if (termId) return termId;
  const { rows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
  return rows[0]?.id || null;
}

async function listTransactions(req, res) {
  const { tenantId } = req.user;
  const { type, termId } = req.query;
  const resolvedTermId = await resolveTermId(tenantId, termId);

  const params = [tenantId];
  let sql = `SELECT * FROM transactions WHERE tenant_id = $1 AND reversed = 0`;
  if (type && ['income', 'expense'].includes(type)) {
    params.push(type);
    sql += ` AND type = $${params.length}`;
  }
  if (resolvedTermId) {
    params.push(resolvedTermId);
    sql += ` AND term_id = $${params.length}`;
  }
  sql += ` ORDER BY occurred_on DESC`;

  const { rows } = await db.query(sql, params);
  res.json({ transactions: rows });
}

async function createTransaction(req, res) {
  const { tenantId, id: userId } = req.user;
  const { type, category, amount, description, occurredOn, termId } = req.body;

  const resolvedTermId = await resolveTermId(tenantId, termId);
  if (!resolvedTermId) {
    return res.status(400).json({ error: 'No current term set — create a term first' });
  }

  const id = randomUUID();
  await db.query(`
    INSERT INTO transactions (id, tenant_id, term_id, type, category, amount, description, occurred_on, recorded_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [id, tenantId, resolvedTermId, type, category, amount, description || null, occurredOn, userId]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'transaction', entityId: id, ipAddress: req.ip, metadata: { type, category, amount, termId: resolvedTermId } });
  res.status(201).json({ id });
}

async function reverseTransaction(req, res) {
  const { tenantId, id: userId, role } = req.user;
  const { id } = req.params;

  if (!['owner', 'accountant'].includes(role)) {
    return res.status(403).json({ error: 'Only an owner or accountant can remove an entry' });
  }

  const { rows } = await db.query(`SELECT id FROM transactions WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const tx = rows[0];
  if (!tx) return res.status(404).json({ error: 'Entry not found' });

  await db.query(`UPDATE transactions SET reversed = 1 WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'transaction', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

module.exports = { listTransactions, createTransaction, reverseTransaction };

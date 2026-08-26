const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Terms are the academic session/term scope for all v2 billing. Every tenant
// has at least one (backfilled at migration time); owners can add more and
// switch the "current" term. Switching never deletes or hides prior-term data.

async function listTerms(req, res) {
  const { tenantId } = req.user;
  const { rows: terms } = await db.query(`
    SELECT * FROM terms WHERE tenant_id = ? ORDER BY created_at DESC
  `, [tenantId]);
  res.json({ terms });
}

async function createTerm(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, startDate, endDate, setCurrent } = req.body;

  const id = randomUUID();
  await db.transaction(async (client) => {
    if (setCurrent) {
      await db.query(`UPDATE terms SET is_current = 0 WHERE tenant_id = ?`, [tenantId], client);
    }
    await db.query(`
      INSERT INTO terms (id, tenant_id, name, start_date, end_date, is_current)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, tenantId, name, startDate || null, endDate || null, setCurrent ? 1 : 0], client);
  });

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'term', entityId: id, ipAddress: req.ip, metadata: { name, setCurrent } });
  res.status(201).json({ id });
}

async function setCurrentTerm(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows } = await db.query(`SELECT id FROM terms WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  const term = rows[0];
  if (!term) return res.status(404).json({ error: 'Term not found' });

  await db.transaction(async (client) => {
    await db.query(`UPDATE terms SET is_current = 0 WHERE tenant_id = ?`, [tenantId], client);
    await db.query(`UPDATE terms SET is_current = 1 WHERE id = ? AND tenant_id = ?`, [id, tenantId], client);
  });

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'term', entityId: id, ipAddress: req.ip, metadata: { setCurrent: true } });
  res.json({ ok: true });
}

module.exports = { listTerms, createTerm, setCurrentTerm };

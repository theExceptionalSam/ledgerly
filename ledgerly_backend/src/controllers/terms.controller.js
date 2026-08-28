const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Terms belong to an academic session. Every tenant has at least one term
// (backfilled at migration time); owners can add, edit, delete, and switch
// the "current" term. Switching never deletes or hides prior-term data.

async function listTerms(req, res) {
  const { tenantId } = req.user;
  const { rows: terms } = await db.query(`
    SELECT t.*, s.name AS session_name
    FROM terms t
    LEFT JOIN academic_sessions s ON s.id = t.session_id
    WHERE t.tenant_id = $1
    ORDER BY t.created_at DESC
  `, [tenantId]);
  res.json({ terms });
}

async function createTerm(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, startDate, endDate, setCurrent, sessionId } = req.body;

  // If no session specified, use the tenant's current session (or create one).
  let resolvedSessionId = sessionId;
  if (!resolvedSessionId) {
    const { rows: sessRows } = await db.query(`SELECT id FROM academic_sessions WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
    if (sessRows[0]) {
      resolvedSessionId = sessRows[0].id;
    } else {
      // No session exists — create a default one.
      resolvedSessionId = randomUUID();
      await db.query(`INSERT INTO academic_sessions (id, tenant_id, name, is_current) VALUES ($1, $2, 'First Session', 1)`, [resolvedSessionId, tenantId]);
    }
  } else {
    const { rows } = await db.query(`SELECT id FROM academic_sessions WHERE id = $1 AND tenant_id = $2`, [resolvedSessionId, tenantId]);
    if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
  }

  const id = randomUUID();
  await db.transaction(async (client) => {
    if (setCurrent) {
      await db.query(`UPDATE terms SET is_current = 0 WHERE tenant_id = $1`, [tenantId], client);
    }
    await db.query(`
      INSERT INTO terms (id, tenant_id, session_id, name, start_date, end_date, is_current)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, tenantId, resolvedSessionId, name, startDate || null, endDate || null, setCurrent ? 1 : 0], client);
  });

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'term', entityId: id, ipAddress: req.ip, metadata: { name, setCurrent, sessionId: resolvedSessionId } });
  res.status(201).json({ id });
}

async function updateTerm(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { name, startDate, endDate } = req.body;

  const { rows } = await db.query(`SELECT id FROM terms WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!rows[0]) return res.status(404).json({ error: 'Term not found' });

  await db.query(`
    UPDATE terms SET name = $1, start_date = $2, end_date = $3
    WHERE id = $4 AND tenant_id = $5
  `, [name, startDate || null, endDate || null, id, tenantId]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'term', entityId: id, ipAddress: req.ip, metadata: { name } });
  res.json({ ok: true });
}

async function deleteTerm(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows } = await db.query(`SELECT id, is_current FROM terms WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const term = rows[0];
  if (!term) return res.status(404).json({ error: 'Term not found' });
  if (term.is_current) return res.status(400).json({ error: 'Cannot delete the current term. Switch to another term first.' });

  // Block deletion if the term has fee assignments or payments — financial
  // history must never be silently destroyed.
  const { rows: usage } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM student_fee_assignments WHERE term_id = $1 AND tenant_id = $2) AS assignments,
      (SELECT COUNT(*) FROM payments WHERE term_id = $1 AND tenant_id = $2) AS payments
  `, [id, tenantId]);
  if (Number(usage[0].assignments) > 0 || Number(usage[0].payments) > 0) {
    return res.status(400).json({ error: 'Cannot delete a term that has fee assignments or payments. These records are permanent for audit integrity.' });
  }

  await db.query(`DELETE FROM terms WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'term', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

async function setCurrentTerm(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows } = await db.query(`SELECT id FROM terms WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!rows[0]) return res.status(404).json({ error: 'Term not found' });

  await db.transaction(async (client) => {
    await db.query(`UPDATE terms SET is_current = 0 WHERE tenant_id = $1`, [tenantId], client);
    await db.query(`UPDATE terms SET is_current = 1 WHERE id = $1 AND tenant_id = $2`, [id, tenantId], client);
  });

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'term', entityId: id, ipAddress: req.ip, metadata: { setCurrent: true } });
  res.json({ ok: true });
}

module.exports = { listTerms, createTerm, updateTerm, deleteTerm, setCurrentTerm };

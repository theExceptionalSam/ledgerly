const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Academic sessions group terms (e.g. "2025/2026 Session" contains
// 1st Term, 2nd Term, 3rd Term). One session per tenant is "current".

async function listSessions(req, res) {
  const { tenantId } = req.user;
  const { rows: sessions } = await db.query(`
    SELECT s.*, (
      SELECT json_agg(json_build_object(
        'id', t.id, 'name', t.name, 'is_current', t.is_current,
        'start_date', t.start_date, 'end_date', t.end_date, 'session_id', t.session_id
      ) ORDER BY t.created_at)
      FROM terms t WHERE t.session_id = s.id
    ) AS terms
    FROM academic_sessions s
    WHERE s.tenant_id = $1
    ORDER BY s.created_at DESC
  `, [tenantId]);
  res.json({ sessions });
}

async function createSession(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, setCurrent } = req.body;

  const id = randomUUID();
  await db.transaction(async (client) => {
    if (setCurrent) {
      await db.query(`UPDATE academic_sessions SET is_current = 0 WHERE tenant_id = $1`, [tenantId], client);
    }
    await db.query(`
      INSERT INTO academic_sessions (id, tenant_id, name, is_current)
      VALUES ($1, $2, $3, $4)
    `, [id, tenantId, name, setCurrent ? 1 : 0], client);
  });

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'session', entityId: id, ipAddress: req.ip, metadata: { name } });
  res.status(201).json({ id });
}

async function updateSession(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { name } = req.body;

  const { rows } = await db.query(`SELECT id FROM academic_sessions WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!rows[0]) return res.status(404).json({ error: 'Session not found' });

  await db.query(`UPDATE academic_sessions SET name = $1 WHERE id = $2 AND tenant_id = $3`, [name, id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'session', entityId: id, ipAddress: req.ip, metadata: { name } });
  res.json({ ok: true });
}

async function deleteSession(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows } = await db.query(`SELECT id, is_current FROM academic_sessions WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const session = rows[0];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.is_current) return res.status(400).json({ error: 'Cannot delete the current session. Switch to another session first.' });

  // Check if any terms in this session have fee assignments or payments
  const { rows: usage } = await db.query(`
    SELECT COUNT(*) AS n FROM student_fee_assignments sfa
    JOIN terms t ON t.id = sfa.term_id
    WHERE t.session_id = $1 AND sfa.tenant_id = $2
  `, [id, tenantId]);
  if (Number(usage[0].n) > 0) {
    return res.status(400).json({ error: 'Cannot delete a session that has fee assignments. Archive it instead, or remove the assignments first.' });
  }

  await db.query(`DELETE FROM terms WHERE session_id = $1 AND tenant_id = $2`, [id, tenantId]);
  await db.query(`DELETE FROM academic_sessions WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'session', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

async function setCurrentSession(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows } = await db.query(`SELECT id FROM academic_sessions WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!rows[0]) return res.status(404).json({ error: 'Session not found' });

  await db.transaction(async (client) => {
    await db.query(`UPDATE academic_sessions SET is_current = 0 WHERE tenant_id = $1`, [tenantId], client);
    await db.query(`UPDATE academic_sessions SET is_current = 1 WHERE id = $1 AND tenant_id = $2`, [id, tenantId], client);
  });

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'session', entityId: id, ipAddress: req.ip, metadata: { setCurrent: true } });
  res.json({ ok: true });
}

module.exports = { listSessions, createSession, updateSession, deleteSession, setCurrentSession };

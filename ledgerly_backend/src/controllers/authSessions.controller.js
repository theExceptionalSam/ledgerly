const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Active session management — list/revoke refresh tokens for the current user.
//
// Lets a user see "where am I logged in" and revoke a specific device without
// logging out everywhere. The refresh_tokens table gained user_agent + ip_address
// columns in migration 017; older rows will have those as NULL but are still listed
// (they're real sessions that haven't been rotated yet).

async function listSessions(req, res) {
  const { rows } = await db.query(
    `SELECT id, user_agent, ip_address, created_at, expires_at, revoked_at
     FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ sessions: rows });
}

async function revokeSession(req, res) {
  const { id } = req.params;
  const result = await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [id, req.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found or already revoked' });
  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'delete', entityType: 'session', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

module.exports = { listSessions, revokeSession };

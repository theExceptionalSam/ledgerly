const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Internal helper — exported so other controllers can raise notifications without
// going through a route. Used by payment plans, term closing, data requests, etc.
// Not awaited by callers unless they want the row before continuing — fire-and-forget
// is fine because a notification failure must never break the calling operation.
async function createNotification(tenantId, userId, type, title, body, entityType, entityId) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO notifications (id, tenant_id, user_id, type, title, body, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, tenantId, userId, type, title, body || null, entityType || null, entityId || null]
  );
  return id;
}

// Unread notifications for the current user, newest first. Read notifications are
// excluded — the bell icon shows what's new, not the full history.
async function listNotifications(req, res) {
  const { rows } = await db.query(
    `SELECT id, type, title, body, entity_type, entity_id, read, created_at
     FROM notifications
     WHERE tenant_id = $1 AND user_id = $2 AND read = 0
     ORDER BY created_at DESC
     LIMIT 100`,
    [req.user.tenantId, req.user.id]
  );
  res.json({ notifications: rows });
}

async function markRead(req, res) {
  const { id } = req.params;
  const result = await db.query(
    `UPDATE notifications SET read = 1
     WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
    [id, req.user.tenantId, req.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true });
}

async function markAllRead(req, res) {
  await db.query(
    `UPDATE notifications SET read = 1
     WHERE tenant_id = $1 AND user_id = $2 AND read = 0`,
    [req.user.tenantId, req.user.id]
  );
  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'update', entityType: 'notification', ipAddress: req.ip, metadata: { markAllRead: true } });
  res.json({ ok: true });
}

module.exports = { createNotification, listNotifications, markRead, markAllRead };

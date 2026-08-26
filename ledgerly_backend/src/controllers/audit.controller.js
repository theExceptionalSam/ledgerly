const db = require('../db');
const { recordAudit } = require('../utils/audit');

async function listAuditLogs(req, res) {
  const { tenantId } = req.user;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

  const { rows } = await db.query(`
    SELECT a.*, u.name AS actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.tenant_id = $1
    ORDER BY a.created_at DESC
    LIMIT $2
  `, [tenantId, limit]);

  res.json({ logs: rows });
}

// Bulk delete audit log entries — owner only. Accepts either:
// - { ids: [...] } to delete specific entries
// - { before: "ISO date" } to delete all entries older than that date
async function bulkDeleteAuditLogs(req, res) {
  const { tenantId, id: userId } = req.user;
  const { ids, before } = req.body;
  let deleted = 0;

  if (ids && Array.isArray(ids) && ids.length > 0) {
    const result = await db.query(`DELETE FROM audit_logs WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, ids]);
    deleted = result.rowCount;
  } else if (before) {
    const result = await db.query(`DELETE FROM audit_logs WHERE tenant_id = $1 AND created_at < $2`, [tenantId, before]);
    deleted = result.rowCount;
  } else {
    return res.status(400).json({ error: 'Provide either ids array or before date' });
  }

  // Record that logs were deleted (this entry itself is kept)
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'audit_log', ipAddress: req.ip, metadata: { deleted, action: 'bulk_delete' } });
  res.json({ deleted });
}

module.exports = { listAuditLogs, bulkDeleteAuditLogs };

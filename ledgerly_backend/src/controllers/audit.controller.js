const db = require('../db');
const { recordAudit } = require('../utils/audit');

function listAuditLogs(req, res) {
  const { tenantId } = req.user;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

  const rows = db.prepare(`
    SELECT a.*, u.name AS actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.tenant_id = ?
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(tenantId, limit);

  // Viewing the audit log is itself an auditable, sensitive action
  recordAudit({ tenantId, actorUserId: req.user.id, action: 'access', entityType: 'audit_log', ipAddress: req.ip });

  res.json({ logs: rows });
}

module.exports = { listAuditLogs };

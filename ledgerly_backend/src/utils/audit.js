const { randomUUID } = require('crypto');
const db = require('../db');

const insertAudit = db.prepare(`
  INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, entity_id, ip_address, metadata)
  VALUES (@id, @tenant_id, @actor_user_id, @action, @entity_type, @entity_id, @ip_address, @metadata)
`);

/**
 * Records an immutable audit trail entry.
 * action: 'create' | 'update' | 'delete' | 'access' | 'login' | 'login_failed' | 'export'
 */
function recordAudit({ tenantId, actorUserId, action, entityType, entityId, ipAddress, metadata }) {
  insertAudit.run({
    id: randomUUID(),
    tenant_id: tenantId,
    actor_user_id: actorUserId || null,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    ip_address: ipAddress || null,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

module.exports = { recordAudit };

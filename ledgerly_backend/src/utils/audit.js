const { randomUUID } = require('crypto');
const db = require('../db');

/**
 * Records an immutable audit trail entry.
 * action: 'create' | 'update' | 'delete' | 'access' | 'login' | 'login_failed' | 'export'
 * Returns a Promise — callers should await it to ensure the audit row is written
 * before the response is sent.
 *
 * The optional `client` argument lets the audit INSERT participate in the caller's
 * open transaction (passed as the 3rd arg to db.query). Omit it to use the pool.
 */
async function recordAudit({ tenantId, actorUserId, action, entityType, entityId, ipAddress, metadata }, client) {
  await db.query(
    `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, entity_id, ip_address, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      tenantId,
      actorUserId || null,
      action,
      entityType,
      entityId || null,
      ipAddress || null,
      metadata ? JSON.stringify(metadata) : null,
    ],
    client
  );
}

module.exports = { recordAudit };

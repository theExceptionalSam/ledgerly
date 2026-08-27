const db = require('../db');
const { recordAudit } = require('../utils/audit');

// List audit logs with enriched context. By default, only shows non-deleted
// entries. Pass ?includeDeleted=true to see soft-deleted entries.
async function listAuditLogs(req, res) {
  const { tenantId } = req.user;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const showDeleted = req.query.deleted === 'true';
  const search = req.query.search;

  const deletedFilter = showDeleted
    ? `AND a.deleted_at IS NOT NULL`
    : `AND a.deleted_at IS NULL`;

  // Server-side search across actor name, action, entity_type, and metadata.
  // Searches the raw metadata JSON + joined entity names for full coverage.
  let searchFilter = '';
  const params = [tenantId];
  if (search && search.trim()) {
    searchFilter = ` AND (
      u.name ILIKE $${params.length + 1} OR
      a.action ILIKE $${params.length + 1} OR
      a.entity_type ILIKE $${params.length + 1} OR
      a.metadata::text ILIKE $${params.length + 1} OR
      s.name ILIKE $${params.length + 1} OR
      fh.name ILIKE $${params.length + 1} OR
      t.category ILIKE $${params.length + 1}
    )`;
    params.push(`%${search.trim()}%`);
  }
  params.push(limit);

  const { rows } = await db.query(`
    SELECT a.*,
      u.name AS actor_name,
      p.amount AS payment_amount,
      p.method AS payment_method,
      s.name AS student_name,
      fh.name AS fee_head_name,
      t.category AS tx_category,
      t.type AS tx_type,
      t.amount AS tx_amount
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN payments p ON p.id = a.entity_id AND a.entity_type = 'payment'
    LEFT JOIN students s ON s.id = p.student_id
    LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
    LEFT JOIN transactions t ON t.id = a.entity_id AND a.entity_type = 'transaction'
    WHERE a.tenant_id = $1 ${deletedFilter} ${searchFilter}
    ORDER BY a.created_at DESC
    LIMIT $${params.length}
  `, params);

  // Enrich metadata with JOINed data for old entries.
  const enriched = rows.map((row) => {
    const m = row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : {};
    if (row.entity_type === 'payment' && row.action === 'create') {
      if (!m.studentName && row.student_name) m.studentName = row.student_name;
      if (!m.feeHeadName && row.fee_head_name) m.feeHeadName = row.fee_head_name;
      if (m.amount == null && row.payment_amount != null) m.amount = Number(row.payment_amount);
    }
    if (row.entity_type === 'transaction') {
      if (!m.category && row.tx_category) m.category = row.tx_category;
      if (!m.type && row.tx_type) m.type = row.tx_type;
      if (m.amount == null && row.tx_amount != null) m.amount = Number(row.tx_amount);
    }
    return { ...row, metadata: m };
  });

  res.json({ logs: enriched });
}

// Soft-delete audit log entries — sets deleted_at instead of hard-deleting.
async function bulkDeleteAuditLogs(req, res) {
  const { tenantId, id: userId } = req.user;
  const { ids, before } = req.body;
  let deleted = 0;

  if (ids && Array.isArray(ids) && ids.length > 0) {
    const result = await db.query(
      `UPDATE audit_logs SET deleted_at = now() WHERE tenant_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`,
      [tenantId, ids]
    );
    deleted = result.rowCount;
  } else if (before) {
    const result = await db.query(
      `UPDATE audit_logs SET deleted_at = now() WHERE tenant_id = $1 AND created_at < $2 AND deleted_at IS NULL`,
      [tenantId, before]
    );
    deleted = result.rowCount;
  } else {
    return res.status(400).json({ error: 'Provide either ids array or before date' });
  }

  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'audit_log', ipAddress: req.ip, metadata: { deleted, action: 'bulk_delete' } });
  res.json({ deleted });
}

// Restore soft-deleted audit log entries.
async function restoreAuditLogs(req, res) {
  const { tenantId, id: userId } = req.user;
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No IDs provided' });
  }

  const result = await db.query(
    `UPDATE audit_logs SET deleted_at = NULL WHERE tenant_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NOT NULL`,
    [tenantId, ids]
  );

  res.json({ restored: result.rowCount });
}

module.exports = { listAuditLogs, bulkDeleteAuditLogs, restoreAuditLogs };

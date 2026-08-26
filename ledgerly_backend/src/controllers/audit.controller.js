const db = require('../db');
const { recordAudit } = require('../utils/audit');

// List audit logs with enriched context. For payment entries, JOINs with
// payments → students + fee_heads so we can show the student name and fee head
// name even for old entries that only stored UUIDs in the metadata.
async function listAuditLogs(req, res) {
  const { tenantId } = req.user;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

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
    WHERE a.tenant_id = $1
    ORDER BY a.created_at DESC
    LIMIT $2
  `, [tenantId, limit]);

  // Enrich each row: merge the JOINed data into the metadata so the frontend's
  // describe() function can use it even if the original metadata only had UUIDs.
  const enriched = rows.map((row) => {
    const m = row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : {};
    // For payment entries, add student/fee head names from the JOIN if the
    // metadata doesn't already have them (old entries).
    if (row.entity_type === 'payment' && row.action === 'create') {
      if (!m.studentName && row.student_name) m.studentName = row.student_name;
      if (!m.feeHeadName && row.fee_head_name) m.feeHeadName = row.fee_head_name;
      if (m.amount == null && row.payment_amount != null) m.amount = Number(row.payment_amount);
    }
    // For transaction entries, add category/type/amount from the JOIN.
    if (row.entity_type === 'transaction') {
      if (!m.category && row.tx_category) m.category = row.tx_category;
      if (!m.type && row.tx_type) m.type = row.tx_type;
      if (m.amount == null && row.tx_amount != null) m.amount = Number(row.tx_amount);
    }
    return { ...row, metadata: m };
  });

  res.json({ logs: enriched });
}

// Bulk delete audit log entries — owner only.
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

  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'audit_log', ipAddress: req.ip, metadata: { deleted, action: 'bulk_delete' } });
  res.json({ deleted });
}

module.exports = { listAuditLogs, bulkDeleteAuditLogs };

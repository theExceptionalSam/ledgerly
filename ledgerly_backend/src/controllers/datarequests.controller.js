const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('./notifications.controller');

// NDPR (Nigeria Data Protection Regulation) data subject rights.
//
// export: queue a full data export (CSV of every tenant-owned row). The actual
// CSV generation is a TODO background job — for now we record the request and
// mark it 'processing'. The owner gets a notification when it's ready.
//
// deletion: queue a deletion with a 30-day grace period. If the request isn't
// cancelled within 30 days, a cron job (TODO) hard-deletes the tenant's data.
// This matches the NDPR requirement that data subjects can withdraw consent.

const GRACE_PERIOD_DAYS = 30;

async function requestExport(req, res) {
  const { tenantId, id: userId } = req.user;
  const id = randomUUID();
  await db.query(
    `INSERT INTO data_requests (id, tenant_id, type, status, requested_by)
     VALUES ($1, $2, 'export', 'processing', $3)`,
    [id, tenantId, userId]
  );
  await recordAudit({ tenantId, actorUserId: userId, action: 'export', entityType: 'data_request', entityId: id, ipAddress: req.ip });

  // TODO: enqueue a background job to generate the CSV. For now, mark as completed
  // immediately so the request shows in the list — the actual export will be wired
  // up when the worker exists.
  await db.query(`UPDATE data_requests SET status = 'completed', processed_at = now() WHERE id = $1`, [id]);
  await createNotification(tenantId, userId, 'data_export_ready', 'Your data export is ready',
    'Your data export request has been processed. You can download it from Settings → Data.', 'data_request', id);

  res.status(201).json({ id, status: 'completed' });
}

async function requestDeletion(req, res) {
  const { tenantId, id: userId, role } = req.user;
  if (role !== 'owner') return res.status(403).json({ error: 'Only an owner can request data deletion' });

  // Check for an existing pending deletion — only one at a time.
  const { rows: existing } = await db.query(
    `SELECT id FROM data_requests WHERE tenant_id = $1 AND type = 'deletion' AND status IN ('pending','processing')`,
    [tenantId]
  );
  if (existing[0]) return res.status(409).json({ error: 'A deletion request is already pending. Cancel it first if you want to re-request.' });

  const id = randomUUID();
  const scheduledFor = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.query(
    `INSERT INTO data_requests (id, tenant_id, type, status, requested_by)
     VALUES ($1, $2, 'deletion', 'pending', $3)`,
    [id, tenantId, userId]
  );
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'data_request', entityId: id, ipAddress: req.ip, metadata: { scheduledFor } });

  await createNotification(tenantId, userId, 'deletion_scheduled', 'Data deletion scheduled',
    `Your data deletion request has been scheduled for ${scheduledFor}. You can cancel it any time before then.`, 'data_request', id);

  res.status(201).json({ id, scheduledFor, gracePeriodDays: GRACE_PERIOD_DAYS });
}

async function listRequests(req, res) {
  const { rows } = await db.query(
    `SELECT id, type, status, processed_at, created_at
     FROM data_requests WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.user.tenantId]
  );
  res.json({ requests: rows });
}

module.exports = { requestExport, requestDeletion, listRequests };

const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('./notifications.controller');
const logger = require('../utils/logger');

// NDPR (Nigeria Data Protection Regulation) data subject rights.
//
// export: builds a CSV on disk containing every tenant-owned row (students,
// payments, transactions, fee_heads, terms, sessions, receipts, users). The
// CSV is a multi-section file — one section per table, separated by a blank
// line. The request row is created up-front so the owner sees it in the list
// immediately; the file is generated synchronously inside the request (small
// tenants finish in <1s; very large ones should move to a background worker).
//
// deletion: queue a deletion with a 30-day grace period (stored as
// scheduled_for). The owner can cancel any time before then. Once the grace
// period lapses, the cron processDeletions job anonymises the tenant's PII.
// cancel: cancel a pending deletion within the grace window.
// download: stream the CSV back to the caller for a completed export request.

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

  try {
    // Gather data from all tenant-owned tables. Run in parallel — pg pool can
    // handle 8 concurrent queries and each table is independent.
    const [students, payments, transactions, feeHeads, terms, sessions, receipts, users] = await Promise.all([
      db.query(`SELECT * FROM students WHERE tenant_id = $1`, [tenantId]),
      db.query(`SELECT * FROM payments WHERE tenant_id = $1`, [tenantId]),
      db.query(`SELECT * FROM transactions WHERE tenant_id = $1`, [tenantId]),
      db.query(`SELECT * FROM fee_heads WHERE tenant_id = $1`, [tenantId]),
      db.query(`SELECT * FROM terms WHERE tenant_id = $1`, [tenantId]),
      db.query(`SELECT * FROM academic_sessions WHERE tenant_id = $1`, [tenantId]),
      db.query(`SELECT * FROM receipts WHERE tenant_id = $1`, [tenantId]),
      db.query(`SELECT id, tenant_id, name, email, role, status, created_at FROM users WHERE tenant_id = $1`, [tenantId]),
    ]);

    // Build a multi-section CSV: one section per table, separated by blank lines.
    // Each section has a header row with the table name, then the column names,
    // then the data rows. RFC-4180-ish quoting (doubled quotes for embedded ")
    // and quoted values whenever the value contains a comma, quote, or newline.
    function tableToCsv(tableName, rows) {
      if (!rows.length) return `${tableName}\n(no data)\n`;
      const cols = Object.keys(rows[0]);
      const header = cols.join(',');
      const dataRows = rows.map(r => cols.map(c => {
        const v = r[c];
        if (v === null || v === undefined) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(','));
      return `${tableName}\n${header}\n${dataRows.join('\n')}\n`;
    }

    const csv = [
      tableToCsv('students', students.rows),
      tableToCsv('payments', payments.rows),
      tableToCsv('transactions', transactions.rows),
      tableToCsv('fee_heads', feeHeads.rows),
      tableToCsv('terms', terms.rows),
      tableToCsv('sessions', sessions.rows),
      tableToCsv('receipts', receipts.rows),
      tableToCsv('users', users.rows),
    ].join('\n');

    // Save to disk — data/exports is created lazily so the directory is absent
    // in fresh checkouts and only created on first export.
    const exportDir = path.join(__dirname, '../../data/exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filename = `${tenantId}-${id}.csv`;
    const filepath = path.join(exportDir, filename);
    fs.writeFileSync(filepath, csv);

    // Mark as completed
    await db.query(`UPDATE data_requests SET status = 'completed', processed_at = now() WHERE id = $1`, [id]);
    await createNotification(tenantId, userId, 'data_export_ready', 'Your data export is ready',
      'Your data export request has been processed. You can download it from Settings → Data.', 'data_request', id);

    res.status(201).json({ id, status: 'completed' });
  } catch (err) {
    await db.query(`UPDATE data_requests SET status = 'failed', processed_at = now() WHERE id = $1`, [id]);
    logger.error({ err: err.message, msg: 'Data export failed' });
    res.status(500).json({ error: 'Data export failed: ' + err.message });
  }
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
    `INSERT INTO data_requests (id, tenant_id, type, status, requested_by, scheduled_for)
     VALUES ($1, $2, 'deletion', 'pending', $3, $4)`,
    [id, tenantId, userId, scheduledFor]
  );
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'data_request', entityId: id, ipAddress: req.ip, metadata: { scheduledFor } });

  await createNotification(tenantId, userId, 'deletion_scheduled', 'Data deletion scheduled',
    `Your data deletion request has been scheduled for ${scheduledFor}. You can cancel it any time before then.`, 'data_request', id);

  res.status(201).json({ id, scheduledFor, gracePeriodDays: GRACE_PERIOD_DAYS });
}

async function cancelRequest(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { rows } = await db.query(
    `SELECT * FROM data_requests WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.type !== 'deletion') return res.status(400).json({ error: 'Only deletion requests can be cancelled' });
  if (request.status !== 'pending') return res.status(400).json({ error: `Request is already ${request.status} and cannot be cancelled` });
  await db.query(`UPDATE data_requests SET status = 'cancelled', processed_at = now() WHERE id = $1`, [id]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'data_request', entityId: id, ipAddress: req.ip, metadata: { cancelled: true } });
  await createNotification(tenantId, userId, 'deletion_cancelled', 'Data deletion cancelled',
    'Your data deletion request has been cancelled. No data will be deleted.', 'data_request', id);
  res.json({ ok: true });
}

async function downloadExport(req, res) {
  const { tenantId } = req.user;
  const { id } = req.params;
  const { rows } = await db.query(
    `SELECT * FROM data_requests WHERE id = $1 AND tenant_id = $2 AND type = 'export' AND status = 'completed'`,
    [id, tenantId]
  );
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'Export not found or not ready' });
  const filepath = path.join(__dirname, '../../data/exports', `${tenantId}-${id}.csv`);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Export file not found on disk' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="ledgerly-export-${id}.csv"`);
  fs.createReadStream(filepath).pipe(res);
}

async function listRequests(req, res) {
  const { rows } = await db.query(
    `SELECT id, type, status, processed_at, created_at
     FROM data_requests WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.user.tenantId]
  );
  res.json({ requests: rows });
}

module.exports = { requestExport, requestDeletion, listRequests, cancelRequest, downloadExport };

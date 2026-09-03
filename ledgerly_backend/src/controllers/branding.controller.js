const db = require('../db');
const { recordAudit } = require('../utils/audit');
const path = require('path');

// Tenant branding — school logo + receipt footer text.
//
// Logo persistence: the logo is stored as a base64 data URL in the
// `tenants.logo_data_url` column. The previous implementation wrote the file
// to data/logos/ on disk, but Render's filesystem is ephemeral — files are
// lost on every redeploy, so a logo that uploaded fine would be missing by
// the time the next receipt PDF was generated. Storing the data URL in the
// DB keeps it with the tenant row across deploys and replicas.
//
// The `logo_path` column is retained for backward compatibility (existing
// rows are not rewritten) but is no longer written by uploadLogo.

async function getBranding(req, res) {
  const { tenantId } = req.user;
  const { rows } = await db.query(
    `SELECT name, logo_path, logo_data_url, receipt_footer FROM tenants WHERE id = $1`,
    [tenantId]
  );
  res.json({ branding: rows[0] || {} });
}

async function uploadLogo(req, res) {
  const { tenantId, id: userId } = req.user;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Convert the uploaded file to a base64 data URL — stored in the DB so it
  // survives Render's ephemeral filesystem (files on disk are lost on redeploy).
  const ext = path.extname(req.file.originalname) || '.png';
  const mimeType = ext === '.png' ? 'image/png'
    : ext === '.gif' ? 'image/gif'
    : ext === '.webp' ? 'image/webp'
    : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;

  await db.query(
    `UPDATE tenants SET logo_data_url = $1 WHERE id = $2`,
    [dataUrl, tenantId]
  );

  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'update',
    entityType: 'tenant',
    entityId: tenantId,
    ipAddress: req.ip,
    metadata: { logoUploaded: true },
  });
  res.json({ ok: true });
}

async function updateFooter(req, res) {
  const { tenantId, id: userId } = req.user;
  const { footer } = req.body;
  await db.query(
    `UPDATE tenants SET receipt_footer = $1 WHERE id = $2`,
    [footer || null, tenantId]
  );
  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'update',
    entityType: 'tenant',
    entityId: tenantId,
    ipAddress: req.ip,
    metadata: { footerUpdated: true },
  });
  res.json({ ok: true });
}

module.exports = { getBranding, uploadLogo, updateFooter };

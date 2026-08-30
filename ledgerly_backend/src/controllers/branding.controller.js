const db = require('../db');
const { recordAudit } = require('../utils/audit');
const path = require('path');
const fs = require('fs');

// Tenant branding — school logo + receipt footer text.

async function getBranding(req, res) {
  const { tenantId } = req.user;
  const { rows } = await db.query(`SELECT name, logo_path, receipt_footer FROM tenants WHERE id = $1`, [tenantId]);
  res.json({ branding: rows[0] || {} });
}

async function uploadLogo(req, res) {
  const { tenantId, id: userId } = req.user;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Save logo to a persistent location
  const uploadDir = path.join(__dirname, '../../data/logos');
  fs.mkdirSync(uploadDir, { recursive: true });
  const ext = path.extname(req.file.originalname) || '.png';
  const filename = `${tenantId}${ext}`;
  const filepath = path.join(uploadDir, filename);
  fs.writeFileSync(filepath, req.file.buffer);

  // Store relative path
  const logoPath = `/data/logos/${filename}`;
  await db.query(`UPDATE tenants SET logo_path = $1 WHERE id = $2`, [logoPath, tenantId]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'tenant', entityId: tenantId, ipAddress: req.ip, metadata: { logoUploaded: true } });
  res.json({ ok: true, logoPath });
}

async function updateFooter(req, res) {
  const { tenantId, id: userId } = req.user;
  const { footer } = req.body;
  await db.query(`UPDATE tenants SET receipt_footer = $1 WHERE id = $2`, [footer || null, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'tenant', entityId: tenantId, ipAddress: req.ip, metadata: { footerUpdated: true } });
  res.json({ ok: true });
}

module.exports = { getBranding, uploadLogo, updateFooter };

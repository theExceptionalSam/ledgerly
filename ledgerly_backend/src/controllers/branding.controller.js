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

// SECURITY: magic-byte signatures for each allowed image format. The route's
// multer fileFilter checks the filename extension AND the declared MIME type,
// but both are attacker-controlled. The check below inspects the actual bytes
// of the uploaded buffer and rejects anything that doesn't start with a known
// image signature. This is the only reliable way to prevent a user from
// uploading, say, an HTML file with embedded JS named "logo.png" — the bytes
// would not match any image signature and the upload would be refused.
//
// Returns the MIME type implied by the magic bytes, or null if no signature
// matches. We re-derive the MIME type from the bytes (rather than trusting
// file.mimetype) so the data URL we store reflects what the bytes actually are.
function detectImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
      && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" or "GIF89a"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38
      && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) {
    return 'image/gif';
  }
  // WebP: "RIFF" .... "WEBP"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return 'image/webp';
  }
  return null;
}

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

  // SECURITY: validate the actual file contents against known image magic
  // bytes. Rejects spoofed extensions/MIME types that would have passed the
  // multer fileFilter (which only inspects the filename and Content-Type
  // header, both attacker-controlled).
  const detectedMime = detectImageMime(req.file.buffer);
  if (!detectedMime) {
    return res.status(400).json({ error: 'The uploaded file is not a valid image (PNG, JPEG, GIF, or WebP).' });
  }

  // Convert the uploaded file to a base64 data URL — stored in the DB so it
  // survives Render's ephemeral filesystem (files on disk are lost on redeploy).
  // The MIME type is taken from the magic-byte detection (not the client-supplied
  // Content-Type) so the data URL accurately describes the bytes we're storing.
  const dataUrl = `data:${detectedMime};base64,${req.file.buffer.toString('base64')}`;

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
    metadata: { logoUploaded: true, mime: detectedMime, size: req.file.buffer.length },
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

const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Tenant settings — currency, language, white-label customization (primary color,
// parent company name). The custom_domain column is read-only here (it's set via
// a separate verification flow that adds DNS records) — exposed in GET for display.

async function getSettings(req, res) {
  const { rows } = await db.query(
    `SELECT currency, language, custom_domain, primary_color, parent_company
     FROM tenants WHERE id = $1`,
    [req.user.tenantId]
  );
  const tenant = rows[0];
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json({ settings: tenant });
}

async function updateSettings(req, res) {
  const { tenantId, id: userId, role } = req.user;
  if (role !== 'owner') return res.status(403).json({ error: 'Only an owner can change tenant settings' });

  const { currency, language, primary_color, parent_company } = req.body;
  await db.query(
    `UPDATE tenants
     SET currency = COALESCE($1, currency),
         language = COALESCE($2, language),
         primary_color = COALESCE($3, primary_color),
         parent_company = COALESCE($4, parent_company)
     WHERE id = $5`,
    [currency || null, language || null, primary_color || null, parent_company || null, tenantId]
  );
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'tenant', entityId: tenantId, ipAddress: req.ip, metadata: { currency, language, primary_color, parent_company } });
  res.json({ ok: true });
}

module.exports = { getSettings, updateSettings };

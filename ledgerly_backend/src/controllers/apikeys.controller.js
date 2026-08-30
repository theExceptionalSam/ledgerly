const { randomUUID } = require('crypto');
const crypto = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// API keys for programmatic access (alternative to JWT).
//
// The raw key is shown ONCE at creation time — only the SHA-256 hash is stored
// (key_hash column, UNIQUE). This matches the industry pattern: if a key is lost,
// it can't be recovered — only revoked and re-issued.
//
// Key format: 'ldk_<32 hex chars>_<16 hex chars>' — the prefix lets secret scanners
// (GitHub, GitLab) detect accidental commits, and the two random segments make the
// total entropy 192 bits.

function generateApiKey() {
  const part1 = crypto.randomBytes(16).toString('hex');
  const part2 = crypto.randomBytes(8).toString('hex');
  return `ldk_${part1}_${part2}`;
}

function maskKey(name, createdAt) {
  return { name, createdAt, masked: 'ldk_••••••••••' };
}

async function listKeys(req, res) {
  const { rows } = await db.query(
    `SELECT id, name, permissions, last_used_at, created_at, revoked_at
     FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.user.tenantId]
  );
  // Mask everything — the raw key was returned once at creation and is gone forever.
  const masked = rows.map((k) => ({ ...maskKey(k.name, k.created_at), id: k.id, permissions: k.permissions, lastUsedAt: k.last_used_at, revokedAt: k.revoked_at }));
  res.json({ keys: masked });
}

async function createKey(req, res) {
  const { name, permissions } = req.body;
  const id = randomUUID();
  const raw = generateApiKey();
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex');

  await db.query(
    `INSERT INTO api_keys (id, tenant_id, name, key_hash, permissions)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, req.user.tenantId, name, keyHash, permissions || 'read']
  );
  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'create', entityType: 'api_key', entityId: id, ipAddress: req.ip, metadata: { name, permissions: permissions || 'read' } });

  // The raw key is returned EXACTLY ONCE — the client must store it. Subsequent
  // listKeys() calls only return a masked version.
  res.status(201).json({ id, key: raw, name, permissions: permissions || 'read' });
}

async function revokeKey(req, res) {
  const { id } = req.params;
  const result = await db.query(
    `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
    [id, req.user.tenantId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'API key not found or already revoked' });
  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'delete', entityType: 'api_key', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

module.exports = { listKeys, createKey, revokeKey };

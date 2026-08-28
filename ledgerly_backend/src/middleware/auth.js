const { verifyAccessToken, verifyParentToken } = require('../utils/tokens');
const crypto = require('crypto');
const db = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = verifyAccessToken(token);
    // Reject parent tokens on staff endpoints — a parent token must only be
    // accepted by requireParent, never by requireAuth.
    if (payload.type === 'parent') return res.status(401).json({ error: 'Invalid or expired session' });
    req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Parent portal auth — separate from staff auth. The token's `type` MUST be
// 'parent'. req.parent is set (not req.user) so parent handlers can't accidentally
// be reached by staff tokens (or vice versa).
function requireParent(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Parent authentication required' });

  try {
    const payload = verifyParentToken(token);
    req.parent = { id: payload.sub, tenantId: payload.tenantId };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired parent session' });
  }
}

// API key auth — alternative to JWT for programmatic integrations. The raw key is
// sent in the x-api-key header; we hash it (SHA-256) and look up the hash. The
// tenant is resolved from the key's row, and req.user is populated with a synthetic
// role of 'api' so role checks can allow/deny as needed.
async function requireApiKey(req, res, next) {
  const raw = req.headers['x-api-key'];
  if (!raw) return res.status(401).json({ error: 'API key required' });
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex');

  const { rows } = await db.query(
    `SELECT * FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [keyHash]
  );
  const key = rows[0];
  if (!key) return res.status(401).json({ error: 'Invalid API key' });

  // Update last_used_at (best-effort, don't block on failure)
  db.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [key.id]).catch(() => {});

  req.user = { id: null, tenantId: key.tenant_id, role: 'api', apiKeyId: key.id, permissions: key.permissions };
  next();
}

// Middleware that checks force_change_password — if set, the user can only
// access /auth/* and /users/change-password endpoints until they change it.
async function requirePasswordNotForced(req, res, next) {
  if (!req.user) return next();
  try {
    const { rows } = await db.query(`SELECT force_change_password FROM users WHERE id = $1`, [req.user.id]);
    if (rows[0] && rows[0].force_change_password === 1) {
      return res.status(403).json({ error: 'You must change your password before continuing.', forceChangePassword: true });
    }
  } catch {}
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requirePasswordNotForced, requireParent, requireApiKey };

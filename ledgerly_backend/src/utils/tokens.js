const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Reject known-insecure placeholder values — a deployer who forgets to override
// the .env.example defaults must not get a forgeable JWT system.
const INSECURE_DEFAULTS = ['change-me-access-secret', 'change-me-refresh-secret', ''];
if (!ACCESS_SECRET || !REFRESH_SECRET || INSECURE_DEFAULTS.includes(ACCESS_SECRET) || INSECURE_DEFAULTS.includes(REFRESH_SECRET)) {
  throw new Error('JWT secrets are not configured. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to strong random values (not the .env.example placeholders).');
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, tenantId: user.tenant_id, role: user.role },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function newRefreshToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
  return { raw, hash, expiresAt };
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { signAccessToken, verifyAccessToken, newRefreshToken, hashRefreshToken };

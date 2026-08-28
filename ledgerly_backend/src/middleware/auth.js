const { verifyAccessToken } = require('../utils/tokens');
const db = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
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

module.exports = { requireAuth, requireRole, requirePasswordNotForced };

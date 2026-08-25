const { verifyAccessToken } = require('../utils/tokens');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = verifyAccessToken(token);
    // req.user is the ONLY source of tenant identity for every downstream query.
    // The tenant id is never accepted from the request body or query string.
    req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };

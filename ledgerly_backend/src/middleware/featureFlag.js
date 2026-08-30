const db = require('../db');

// requireFeature('feature_name') — middleware that checks if the feature is
// enabled for the tenant. If the flag doesn't exist for this tenant, default
// to ENABLED (so features work out-of-the-box; the platform admin can
// explicitly disable a feature for a specific tenant by setting enabled=0).
function requireFeature(featureName) {
  return async (req, res, next) => {
    if (!req.user || !req.user.tenantId) return next(); // skip for non-tenant routes
    try {
      const { rows } = await db.query(
        `SELECT enabled FROM feature_flags WHERE tenant_id = $1 AND feature = $2`,
        [req.user.tenantId, featureName]
      );
      // If no flag exists, feature is enabled (default-allow). If flag exists,
      // respect its value (1 = enabled, 0 = disabled).
      if (rows[0] && !rows[0].enabled) {
        return res.status(403).json({ error: `The "${featureName}" feature is not enabled for your school` });
      }
      next();
    } catch (err) {
      // On DB error, allow the request through (fail-open) — don't block all
      // API calls because the feature_flags table is unreachable.
      next();
    }
  };
}

module.exports = { requireFeature };

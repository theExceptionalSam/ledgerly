const db = require('../db');
const logger = require('../utils/logger');

// Platform admin dashboard — cross-tenant metrics for the platform operator.
// Auth is handled by a separate platform_admins table (not tenant users).

// Simple platform admin auth check (separate from tenant auth)
async function requirePlatformAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Platform admin authentication required' });

  try {
    const { rows } = await db.query(`SELECT id, email, name FROM platform_admins WHERE access_token = $1`, [token]);
    if (!rows[0]) return res.status(401).json({ error: 'Invalid platform admin token' });
    req.platformAdmin = rows[0];
    next();
  } catch (err) {
    // Table might not exist yet — fail gracefully
    return res.status(401).json({ error: 'Platform admin not configured' });
  }
}

async function getPlatformOverview(req, res) {
  const { rows: tenants } = await db.query(`
    SELECT
      t.id, t.name, t.phone, t.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
      (SELECT COUNT(*) FROM students s WHERE s.tenant_id = t.id AND s.status = 'active') AS student_count,
      (SELECT COUNT(*) FROM payments p WHERE p.tenant_id = t.id AND p.reversed = 0) AS payment_count,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.tenant_id = t.id AND p.reversed = 0) AS total_collected,
      (SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_active
    FROM tenants t
    ORDER BY t.created_at DESC
  `);

  const totalSchools = tenants.length;
  const totalStudents = tenants.reduce((s, t) => s + Number(t.student_count), 0);
  const totalPayments = tenants.reduce((s, t) => s + Number(t.payment_count), 0);
  const totalCollected = tenants.reduce((s, t) => s + Number(t.total_collected), 0);
  const activeSchools = tenants.filter(t => t.last_active && new Date(t.last_active) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length;

  res.json({
    summary: { totalSchools, activeSchools, totalStudents, totalPayments, totalCollected },
    tenants: tenants.map(t => ({
      ...t,
      student_count: Number(t.student_count),
      payment_count: Number(t.payment_count),
      total_collected: Number(t.total_collected),
      health: t.last_active && new Date(t.last_active) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) ? 'green' :
              t.last_active && new Date(t.last_active) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) ? 'yellow' : 'red',
    })),
  });
}

async function getPlatformHealth(req, res) {
  // Database stats
  const { rows: dbSize } = await db.query(`SELECT pg_database_size(current_database()) AS size`);
  const { rows: tableSizes } = await db.query(`
    SELECT relname AS table, pg_total_relation_size(relid) AS size
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 10
  `);

  // Connection pool stats
  const { rows: connStats } = await db.query(`SELECT count(*) AS total, count(*) FILTER (WHERE state = 'active') AS active FROM pg_stat_activity`);

  res.json({
    database: {
      size: Number(dbSize[0].size),
      tables: tableSizes.map(t => ({ name: t.table, size: Number(t.size) })),
    },
    connections: {
      total: Number(connStats[0].total),
      active: Number(connStats[0].active),
    },
    pool: { max: 10 },
  });
}

module.exports = { requirePlatformAdmin, getPlatformOverview, getPlatformHealth };

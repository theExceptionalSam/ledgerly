const { randomUUID } = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');
const { signAccessToken } = require('../utils/tokens');
const { recordAudit } = require('../utils/audit');

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
      // Postgres COUNT() returns bigint, which the `pg` driver serializes as
      // a string. Coerce all COUNT-derived fields to Number so the JSON
      // response is consistently numeric (the summary reducers above already
      // do this for their inputs).
      user_count: Number(t.user_count),
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

// --- Tier 1: Critical ---

// Issues a real JWT access token for the tenant's owner so the admin can "login as"
// the school. The token is identical in shape to a normal user-issued one, so the
// admin can call any tenant-scoped endpoint with it.
async function impersonateTenant(req, res) {
  const { tenantId } = req.params;
  const { rows } = await db.query(
    `SELECT * FROM users WHERE tenant_id = $1 AND role = 'owner' LIMIT 1`,
    [tenantId]
  );
  const owner = rows[0];
  if (!owner) return res.status(404).json({ error: 'No owner user found for this tenant' });

  // Audit the impersonation in the tenant's own audit log (actor = platform admin id).
  await recordAudit({
    tenantId,
    actorUserId: null,
    action: 'access',
    entityType: 'user',
    entityId: owner.id,
    ipAddress: req.ip,
    metadata: { impersonatedBy: req.platformAdmin.id, adminEmail: req.platformAdmin.email },
  });

  const accessToken = signAccessToken(owner);
  res.json({
    accessToken,
    user: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: owner.role,
      tenantId: owner.tenant_id,
    },
  });
}

async function suspendTenant(req, res) {
  const { id } = req.params;
  const { rows } = await db.query(
    `UPDATE tenants SET status = 'suspended' WHERE id = $1 RETURNING id, name, status`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' });
  await recordAudit({
    tenantId: id,
    actorUserId: null,
    action: 'update',
    entityType: 'tenant',
    entityId: id,
    ipAddress: req.ip,
    metadata: { suspendedBy: req.platformAdmin.id, status: 'suspended' },
  });
  res.json(rows[0]);
}

async function unsuspendTenant(req, res) {
  const { id } = req.params;
  const { rows } = await db.query(
    `UPDATE tenants SET status = 'active' WHERE id = $1 RETURNING id, name, status`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' });
  await recordAudit({
    tenantId: id,
    actorUserId: null,
    action: 'update',
    entityType: 'tenant',
    entityId: id,
    ipAddress: req.ip,
    metadata: { unsuspendedBy: req.platformAdmin.id, status: 'active' },
  });
  res.json(rows[0]);
}

async function getRevenue(req, res) {
  const { rows: mrrRows } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS mrr, COUNT(*) AS active_count FROM subscriptions WHERE status = 'active'`
  );
  const mrr = Number(mrrRows[0].mrr);
  const activeCount = Number(mrrRows[0].active_count);
  const arpu = activeCount > 0 ? Math.round(mrr / activeCount) : 0;

  const { rows: churnRows } = await db.query(
    `SELECT COUNT(*) AS churn FROM subscriptions WHERE status = 'cancelled'`
  );
  const churn = Number(churnRows[0].churn);

  const { rows: planRows } = await db.query(
    `SELECT plan, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM subscriptions GROUP BY plan ORDER BY count DESC`
  );

  res.json({
    mrr,
    arpu,
    churn,
    activeCount,
    planBreakdown: planRows.map(r => ({ plan: r.plan, count: Number(r.count), amount: Number(r.amount) })),
  });
}

async function getErrors(req, res) {
  const { rows } = await db.query(
    `SELECT id, tenant_id, actor_user_id, action, entity_type, entity_id, ip_address, metadata, created_at
     FROM audit_logs
     WHERE action IN ('login_failed', 'delete')
     ORDER BY created_at DESC
     LIMIT 50`
  );
  res.json({ errors: rows });
}

// Same shape as overview's tenant list, but with query-string filters.
// `search` matches tenant name (case-insensitive), `health` filters on the
// computed health bucket, `plan` filters on the tenant's subscription plan.
async function getTenants(req, res) {
  const { search, health, plan } = req.query;
  const params = [];
  const where = [];
  let idx = 1;

  if (search) {
    params.push(`%${search}%`);
    where.push(`t.name ILIKE $${idx++}`);
  }
  if (plan) {
    params.push(plan);
    where.push(`s.plan = $${idx++}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows: tenants } = await db.query(`
    SELECT
      t.id, t.name, t.phone, t.created_at, t.status,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
      (SELECT COUNT(*) FROM students s WHERE s.tenant_id = t.id AND s.status = 'active') AS student_count,
      (SELECT COUNT(*) FROM payments p WHERE p.tenant_id = t.id AND p.reversed = 0) AS payment_count,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.tenant_id = t.id AND p.reversed = 0) AS total_collected,
      (SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_active,
      s.plan, s.amount AS subscription_amount, s.status AS subscription_status
    FROM tenants t
    LEFT JOIN subscriptions s ON s.tenant_id = t.id
    ${whereSql}
    ORDER BY t.created_at DESC
  `, params);

  const computeHealth = (lastActive) => {
    if (!lastActive) return 'red';
    if (new Date(lastActive) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) return 'green';
    if (new Date(lastActive) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) return 'yellow';
    return 'red';
  };

  let result = tenants.map(t => ({
    ...t,
    // Coerce all COUNT-derived fields to Number (same reason as getPlatformOverview).
    user_count: Number(t.user_count),
    student_count: Number(t.student_count),
    payment_count: Number(t.payment_count),
    total_collected: Number(t.total_collected),
    health: computeHealth(t.last_active),
  }));

  if (health) {
    result = result.filter(t => t.health === health);
  }

  res.json({ tenants: result, count: result.length });
}

// --- Tier 2: Important ---

async function getUsage(req, res) {
  // Daily API call counts + distinct active tenants per day for the last 30 days.
  const { rows } = await db.query(`
    SELECT
      date_trunc('day', created_at) AS date,
      COUNT(*) AS request_count,
      COUNT(DISTINCT tenant_id) AS active_tenants
    FROM api_usage
    WHERE created_at >= now() - interval '30 days'
    GROUP BY date_trunc('day', created_at)
    ORDER BY date ASC
  `);
  res.json({
    days: rows.map(r => ({
      date: r.date,
      requestCount: Number(r.request_count),
      activeTenants: Number(r.active_tenants),
    })),
  });
}

async function getFeatureFlags(req, res) {
  const { rows } = await db.query(
    `SELECT f.id, f.tenant_id, t.name AS tenant_name, f.feature, f.enabled, f.created_at
     FROM feature_flags f
     LEFT JOIN tenants t ON t.id = f.tenant_id
     ORDER BY f.created_at DESC`
  );
  res.json({ flags: rows });
}

async function upsertFeatureFlag(req, res) {
  const { tenantId, feature, enabled } = req.body;
  if (!tenantId || !feature) return res.status(400).json({ error: 'tenantId and feature are required' });
  const enabledVal = enabled ? 1 : 0;
  const { rows } = await db.query(`
    INSERT INTO feature_flags (id, tenant_id, feature, enabled)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (tenant_id, feature) DO UPDATE SET enabled = EXCLUDED.enabled
    RETURNING id, tenant_id, feature, enabled, created_at
  `, [randomUUID(), tenantId, feature, enabledVal]);
  res.json(rows[0]);
}

async function getBroadcasts(req, res) {
  const { rows } = await db.query(
    `SELECT b.id, b.tenant_id, t.name AS tenant_name, b.message, b.level, b.active, b.created_at
     FROM broadcast_messages b
     LEFT JOIN tenants t ON t.id = b.tenant_id
     ORDER BY b.created_at DESC`
  );
  res.json({ broadcasts: rows });
}

async function createBroadcast(req, res) {
  const { message, level, tenantId } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  const safeLevel = ['info', 'warning', 'success'].includes(level) ? level : 'info';
  const { rows } = await db.query(`
    INSERT INTO broadcast_messages (id, tenant_id, message, level, active)
    VALUES ($1, $2, $3, $4, 1)
    RETURNING id, tenant_id, message, level, active, created_at
  `, [randomUUID(), tenantId || null, message, safeLevel]);
  res.status(201).json(rows[0]);
}

async function deleteBroadcast(req, res) {
  const { id } = req.params;
  const { rows } = await db.query(
    `UPDATE broadcast_messages SET active = 0 WHERE id = $1 RETURNING id, active`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Broadcast not found' });
  res.json(rows[0]);
}

async function getTenantNotes(req, res) {
  const { id } = req.params;
  const { rows } = await db.query(
    `SELECT n.id, n.tenant_id, n.note, n.created_by, n.created_at, a.email AS admin_email
     FROM tenant_notes n
     LEFT JOIN platform_admins a ON a.id = n.created_by
     WHERE n.tenant_id = $1
     ORDER BY n.created_at DESC`,
    [id]
  );
  res.json({ notes: rows });
}

async function createTenantNote(req, res) {
  const { id } = req.params;
  const { note } = req.body;
  if (!note) return res.status(400).json({ error: 'note is required' });
  const { rows } = await db.query(`
    INSERT INTO tenant_notes (id, tenant_id, note, created_by)
    VALUES ($1, $2, $3, $4)
    RETURNING id, tenant_id, note, created_by, created_at
  `, [randomUUID(), id, note, req.platformAdmin.id]);
  res.status(201).json(rows[0]);
}

// CSV export of all tenants + their usage stats. Streams as a downloadable file.
async function exportTenants(req, res) {
  const { rows } = await db.query(`
    SELECT
      t.id, t.name, t.phone, t.status, t.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
      (SELECT COUNT(*) FROM students s WHERE s.tenant_id = t.id AND s.status = 'active') AS student_count,
      (SELECT COUNT(*) FROM payments p WHERE p.tenant_id = t.id AND p.reversed = 0) AS payment_count,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.tenant_id = t.id AND p.reversed = 0) AS total_collected,
      (SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_active,
      s.plan, s.amount AS subscription_amount, s.status AS subscription_status
    FROM tenants t
    LEFT JOIN subscriptions s ON s.tenant_id = t.id
    ORDER BY t.created_at DESC
  `);

  const headers = [
    'id', 'name', 'phone', 'status', 'created_at',
    'user_count', 'student_count', 'payment_count', 'total_collected',
    'last_active', 'plan', 'subscription_amount', 'subscription_status',
  ];

  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="tenants.csv"');
  res.send(csv);
}

// --- Tier 3: Nice to have ---

// Expanded version of getPlatformHealth's database block — includes index sizes
// and live row estimates per table, plus connection/pool stats.
async function getDatabaseStats(req, res) {
  const { rows: dbSize } = await db.query(`SELECT pg_database_size(current_database()) AS size`);
  const { rows: tableSizes } = await db.query(`
    SELECT relname AS table, pg_total_relation_size(relid) AS total_size,
           pg_relation_size(relid) AS table_size,
           pg_total_relation_size(relid) - pg_relation_size(relid) AS index_size
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
  `);
  const { rows: rowCounts } = await db.query(`
    SELECT relname AS table, n_live_tup AS row_count
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC
  `);
  const { rows: indexSizes } = await db.query(`
    SELECT schemaname, relname AS table, indexrelname AS index,
           pg_total_relation_size(indexrelid) AS size
    FROM pg_catalog.pg_stat_user_indexes
    ORDER BY pg_total_relation_size(indexrelid) DESC
    LIMIT 20
  `);
  const { rows: connStats } = await db.query(
    `SELECT count(*) AS total, count(*) FILTER (WHERE state = 'active') AS active FROM pg_stat_activity`
  );

  const rowCountMap = new Map(rowCounts.map(r => [r.table, Number(r.row_count)]));

  res.json({
    totalSize: Number(dbSize[0].size),
    tables: tableSizes.map(t => ({
      name: t.table,
      totalSize: Number(t.total_size),
      tableSize: Number(t.table_size),
      indexSize: Number(t.index_size),
      rowCount: rowCountMap.get(t.table) || 0,
    })),
    indexes: indexSizes.map(i => ({
      table: i.table,
      index: i.index,
      size: Number(i.size),
    })),
    connections: {
      total: Number(connStats[0].total),
      active: Number(connStats[0].active),
    },
    pool: { max: 10 },
  });
}

async function getDeployments(req, res) {
  const { rows } = await db.query(
    `SELECT id, commit_sha, message, deployed_by, deployed_at FROM deployment_logs ORDER BY deployed_at DESC LIMIT 50`
  );
  res.json({ deployments: rows });
}

async function createDeployment(req, res) {
  const { commitSha, message } = req.body;
  const { rows } = await db.query(`
    INSERT INTO deployment_logs (id, commit_sha, message, deployed_by)
    VALUES ($1, $2, $3, $4)
    RETURNING id, commit_sha, message, deployed_by, deployed_at
  `, [randomUUID(), commitSha || null, message || null, req.platformAdmin.id]);
  res.status(201).json(rows[0]);
}

async function getRateLimits(req, res) {
  const { rows } = await db.query(`
    SELECT
      a.tenant_id, t.name AS tenant_name,
      COUNT(*) AS request_count,
      COALESCE(AVG(a.response_time_ms), 0) AS avg_response_time_ms,
      MAX(a.response_time_ms) AS max_response_time_ms
    FROM api_usage a
    LEFT JOIN tenants t ON t.id = a.tenant_id
    WHERE a.created_at >= now() - interval '24 hours'
    GROUP BY a.tenant_id, t.name
    ORDER BY request_count DESC
  `);
  res.json({
    tenants: rows.map(r => ({
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      requestCount: Number(r.request_count),
      avgResponseTimeMs: Math.round(Number(r.avg_response_time_ms)),
      maxResponseTimeMs: r.max_response_time_ms ? Number(r.max_response_time_ms) : null,
    })),
  });
}

async function getNps(req, res) {
  const { rows } = await db.query(`
    SELECT n.id, n.tenant_id, t.name AS tenant_name, n.user_id, u.name AS user_name,
           n.score, n.comment, n.created_at
    FROM nps_feedback n
    LEFT JOIN tenants t ON t.id = n.tenant_id
    LEFT JOIN users u ON u.id = n.user_id
    ORDER BY n.created_at DESC
  `);

  const scores = rows.map(r => Number(r.score));
  const promoters = scores.filter(s => s >= 9).length;
  const detractors = scores.filter(s => s <= 6).length;
  const total = scores.length;
  const npsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;
  const avgScore = total > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / total) * 10) / 10 : 0;

  res.json({
    score: npsScore,
    avgScore,
    total,
    promoters,
    detractors,
    passives: total - promoters - detractors,
    feedback: rows,
  });
}

async function createNps(req, res) {
  const { tenantId, userId, score, comment } = req.body;
  if (!tenantId || !userId || score === undefined) {
    return res.status(400).json({ error: 'tenantId, userId and score are required' });
  }
  const scoreNum = Number(score);
  if (!Number.isInteger(scoreNum) || scoreNum < 0 || scoreNum > 10) {
    return res.status(400).json({ error: 'score must be an integer between 0 and 10' });
  }
  const { rows } = await db.query(`
    INSERT INTO nps_feedback (id, tenant_id, user_id, score, comment)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, tenant_id, user_id, score, comment, created_at
  `, [randomUUID(), tenantId, userId, scoreNum, comment || null]);
  res.status(201).json(rows[0]);
}

module.exports = {
  requirePlatformAdmin,
  getPlatformOverview,
  getPlatformHealth,
  // Tier 1
  impersonateTenant,
  suspendTenant,
  unsuspendTenant,
  getRevenue,
  getErrors,
  getTenants,
  // Tier 2
  getUsage,
  getFeatureFlags,
  upsertFeatureFlag,
  getBroadcasts,
  createBroadcast,
  deleteBroadcast,
  getTenantNotes,
  createTenantNote,
  exportTenants,
  // Tier 3
  getDatabaseStats,
  getDeployments,
  createDeployment,
  getRateLimits,
  getNps,
  createNps,
};

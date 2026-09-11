const db = require('../db');

// Uptime monitoring endpoint — returns system health for external monitors
// (UptimeRobot, Better Stack, etc.). No auth required (it only returns
// non-sensitive health data). Monitors should check:
//   - HTTP 200 = healthy
//   - HTTP 503 = degraded (DB down)
//   - Response time < 500ms = good
//
// Security: deliberately does NOT expose sensitive data — no DB connection
// strings, no user data, no internal paths. Only generic process stats that
// are safe to surface to an unauthenticated uptime checker.
async function getMonitoring(req, res) {
  const start = Date.now();

  try {
    // Quick DB ping — verifies the pool can serve a query, not just that the
    // process is alive. This is the same check the /health endpoint uses, but
    // the monitoring endpoint surfaces more detail (memory, response time) for
    // external dashboards.
    await db.query('SELECT 1');

    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    res.json({
      status: 'ok',
      db: true,
      uptime: Math.round(uptime),
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      },
      responseTime: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      db: false,
      error: 'Database unreachable',
      responseTime: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = { getMonitoring };

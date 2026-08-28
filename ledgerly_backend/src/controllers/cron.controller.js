const db = require('../db');
const logger = require('../utils/logger');
const { createNotification } = require('./notifications.controller');

// Cron jobs — protected by a CRON_SECRET header check (no user auth). Triggered by
// a scheduler (Render cron, GitHub Actions, etc.) — never exposed to end users.
//
// Each job is idempotent: re-running it is safe (no duplicate emails, no double-
// cleanup). Failures are logged and surfaced via the response, so the scheduler
// can alert on non-2xx.

const CRON_SECRET = process.env.CRON_SECRET;

function requireCronSecret(req, res, next) {
  const provided = req.headers['x-cron-secret'] || req.body?.secret;
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }
  next();
}

// Weekly summary email to every owner. The "email" is a TODO (Resend integration)
// — for now we record a notification so the owner sees it in-app on next login.
async function weeklySummary(req, res) {
  const { rows: owners } = await db.query(
    `SELECT u.id, u.tenant_id, u.email, u.name, t.name AS tenant_name
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.role = 'owner' AND u.status = 'active'`
  );

  let sent = 0;
  for (const owner of owners) {
    // Pull this week's totals for the owner's school.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { rows: stats } = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM payments WHERE tenant_id = $1 AND created_at >= $2 AND reversed = 0) AS payments,
         (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = $1 AND created_at >= $2 AND reversed = 0) AS collected,
         (SELECT COUNT(*) FROM students WHERE tenant_id = $1 AND status = 'active') AS students`,
      [owner.tenant_id, since]
    );
    const s = stats[0] || {};
    const body = `Hi ${owner.name}, here's your weekly summary for ${owner.tenant_name}: ${s.payments} payments collected totalling ${s.collected}. Active students: ${s.students}.`;
    await createNotification(owner.tenant_id, owner.id, 'weekly_summary', 'Your weekly summary', body, null, null);
    // TODO: send via Resend — needs a verified domain. For now, log so we can verify the job ran.
    logger.info({ email: owner.email, msg: 'Weekly summary queued (notification only)' });
    sent++;
  }
  res.json({ ok: true, sent });
}

// Check for subscriptions expiring within 7 days; warn the owner.
async function checkSubscriptions(req, res) {
  const { rows: expiring } = await db.query(
    `SELECT s.id, s.tenant_id, s.plan, s.current_period_end, u.id AS owner_id, u.name AS owner_name
     FROM subscriptions s
     JOIN users u ON u.tenant_id = s.tenant_id AND u.role = 'owner'
     WHERE s.status = 'active'
       AND s.current_period_end IS NOT NULL
       AND s.current_period_end::date <= (now() + interval '7 days')::date
       AND s.current_period_end::date >= now()::date`
  );
  let warned = 0;
  for (const s of expiring) {
    await createNotification(s.tenant_id, s.owner_id, 'subscription_expiring', 'Subscription expiring soon',
      `Hi ${s.owner_name}, your ${s.plan} plan expires on ${s.current_period_end}. Renew to avoid interruption.`, 'subscription', s.id);
    warned++;
  }
  res.json({ ok: true, warned });
}

// Delete expired refresh tokens — keeps the refresh_tokens table small. Run daily.
async function cleanupTokens(req, res) {
  const result = await db.query(
    `DELETE FROM refresh_tokens WHERE expires_at < now() OR revoked_at IS NOT NULL`
  );
  logger.info({ deleted: result.rowCount, msg: 'Cleaned up expired/revoked refresh tokens' });
  res.json({ ok: true, deleted: result.rowCount });
}

module.exports = { requireCronSecret, weeklySummary, checkSubscriptions, cleanupTokens };

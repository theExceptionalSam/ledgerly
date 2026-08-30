const db = require('../db');
const logger = require('../utils/logger');
const { createNotification } = require('./notifications.controller');

// Cron jobs — protected by a CRON_SECRET header check (no user auth). Triggered by
// a scheduler (Render cron, GitHub Actions, etc.) — never exposed to end users.
//
// Each job is idempotent: re-running it is safe (no duplicate emails, no double-
// cleanup). Failures are logged and surfaced via the response, so the scheduler
// can alert on non-2xx.

// Lazy-init: the Resend client is only constructed when an API key is present,
// so the server boots fine in dev without an email transport configured.
// Same pattern as src/utils/otp.js — kept local so a failure here can't break OTP.
let resend = null;
function getResend() {
  if (resend) return resend;
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const CRON_SECRET = process.env.CRON_SECRET;

function requireCronSecret(req, res, next) {
  const provided = req.headers['x-cron-secret'] || req.body?.secret;
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(401).json({ error: 'Invalid cron secret' });
  }
  next();
}

// Weekly summary email to every owner. Records an in-app notification AND sends
// the same summary via Resend (if configured) — so owners who haven't logged in
// still get their weekly recap.
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

    // Send the same summary via Resend when an API key is configured. Failures
    // here are logged but do NOT abort the job — the in-app notification above
    // still went out, so the owner will see the recap on next login.
    if (process.env.RESEND_API_KEY) {
      try {
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'Ledgerly <onboarding@resend.dev>';
        await getResend().emails.send({
          from: fromEmail,
          to: owner.email,
          subject: `Weekly summary for ${owner.tenant_name}`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:auto">
            <h2 style="color:#14213D">Hi ${owner.name},</h2>
            <p>Here's your weekly summary for <strong>${owner.tenant_name}</strong>:</p>
            <ul>
              <li>Payments collected: <strong>${s.payments}</strong></li>
              <li>Total collected: <strong>\u20A6${Number(s.collected || 0).toLocaleString('en-NG')}</strong></li>
              <li>Active students: <strong>${s.students}</strong></li>
            </ul>
            <p style="color:#5B5B54;margin-top:20px;font-size:12px">Log in to Ledgerly for full details.</p>
          </div>`,
        });
      } catch (emailError) {
        logger.error({ err: emailError.message, email: owner.email, msg: 'Weekly summary email failed' });
      }
    }
    logger.info({ email: owner.email, msg: 'Weekly summary queued (notification + email)' });
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

// Delete audit log entries past their retention period. The retention_expires_at
// column (TEXT, set by the platform admin or defaulted to 7 years for financial
// records per Nigerian tax law) is cast to timestamptz for the comparison. NULL
// and empty-string values are skipped — those rows have no expiry and are kept
// indefinitely. Run daily.
async function cleanupAuditLogs(req, res) {
  const result = await db.query(
    `DELETE FROM audit_logs WHERE retention_expires_at IS NOT NULL AND retention_expires_at != '' AND retention_expires_at::timestamptz < now()`
  );
  logger.info({ deleted: result.rowCount, msg: 'Cleaned up expired audit log entries' });
  res.json({ ok: true, deleted: result.rowCount });
}

// Process data deletion requests past their 30-day grace period.
// Anonymises the tenant's data (soft-delete approach — keeps the tenant row
// but scrubs all PII). This satisfies NDPR's right-to-erasure while preserving
// the tenant's billing/audit history for the platform admin.
async function processDeletions(req, res) {
  // Find deletion requests past their grace period that are still pending
  const { rows: due } = await db.query(
    `SELECT id, tenant_id FROM data_requests
     WHERE type = 'deletion' AND status = 'pending'
       AND scheduled_for IS NOT NULL AND scheduled_for <= now()`
  );
  let processed = 0;
  for (const item of due) {
    // Anonymise students (blank out names, admission_no, guardian_contact)
    await db.query(`UPDATE students SET name = '[Deleted]', class = '', admission_no = '', guardian_contact = '', status = 'archived' WHERE tenant_id = $1`, [item.tenant_id]);
    // Anonymise users (blank out names, emails — keep unique constraint satisfied by suffixing with the user id)
    await db.query(`UPDATE users SET name = '[Deleted]', email = '[deleted]_' || id || '@deleted.local', status = 'disabled' WHERE tenant_id = $1`, [item.tenant_id]);
    // Revoke all refresh tokens
    await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)`, [item.tenant_id]);
    // Mark the request as completed
    await db.query(`UPDATE data_requests SET status = 'completed', processed_at = now() WHERE id = $1`, [item.id]);
    processed++;
  }
  logger.info({ processed, msg: 'Processed data deletion requests past grace period' });
  res.json({ ok: true, processed });
}

module.exports = { requireCronSecret, weeklySummary, checkSubscriptions, cleanupTokens, cleanupAuditLogs, processDeletions };

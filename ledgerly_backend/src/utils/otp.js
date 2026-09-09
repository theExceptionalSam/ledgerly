const { randomUUID, randomInt, createHash } = require('crypto');
const db = require('../db');
const logger = require('./logger');

// SECURITY: OTP codes are sensitive — they grant account access (registration
// verification) until they expire. Logging them to stdout in plaintext (as the
// previous `console.log` did) leaks them to anyone with log access (aggregated
// logging services, log shippers, even Splunk/Datadog read-only users). Only
// emit the code to logs when the explicit dev flag is set, and even then use
// the structured logger (so it can be redacted at the shipper level).
const showDevOtp = process.env.LEDGERLY_DEV_SHOW_OTP === 'true';

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

// Lazy-init: the Resend client is only constructed when an API key is present,
// so the server boots fine in dev without an email transport configured.
let resend = null;
function getResend() {
  if (resend) return resend;
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

function hashCode(email, code) {
  return createHash('sha256').update(`${email}:${code}`).digest('hex');
}

async function issueVerificationCode(tenantId, email) {
  const code = String(randomInt(0, 1000000)).padStart(6, '0');

  await db.query(`DELETE FROM verification_codes WHERE tenant_id = $1 AND email = $2`, [tenantId, email]);
  await db.query(
    `INSERT INTO verification_codes (id, tenant_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      randomUUID(),
      tenantId,
      email,
      hashCode(email, code),
      new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()
    ]
  );

  // SECURITY: only emit the code to logs when the explicit dev flag is set, and
  // use the structured logger so log shippers can redact the `otp` field. The
  // previous `console.log` printed every code in plaintext to stdout.
  if (showDevOtp) {
    logger.warn({ email, otp: code, msg: 'OTP issued (dev mode — LEDGERLY_DEV_SHOW_OTP=true)' });
  }

  if (process.env.RESEND_API_KEY) {
    try {
      // The from address: use RESEND_FROM_EMAIL if set (for verified domains),
      // otherwise fall back to Resend's shared test address (only works for
      // sending to the account owner's own email on the free plan).
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'Ledgerly <onboarding@resend.dev>';
      await getResend().emails.send({
        from: fromEmail,
        to: email,
        subject: 'Your Ledgerly Verification Code',
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto">
            <h2>Verify your email</h2>
            <p>Your verification code is:</p>
            <h1 style="letter-spacing:8px;color:#14213D">${code}</h1>
            <p>This code expires in ${OTP_TTL_MINUTES} minutes.</p>
            <p>If you didn't request this, ignore this email.</p>
          </div>
        `,
      });
    } catch (emailError) {
      // Don't leak the email address into generic logs at error level — log via
      // the structured logger which the operator can route/redact.
      logger.error({ err: emailError.message, msg: 'Failed to send OTP email via Resend' });
    }
  }

  return code;
}

async function verifyCode(tenantId, email, code) {
  const { rows } = await db.query(
    `SELECT * FROM verification_codes WHERE tenant_id = $1 AND email = $2 AND consumed_at IS NULL`,
    [tenantId, email]
  );
  const record = rows[0];
  if (!record) return { ok: false, error: 'No verification code found. Request a new one.' };
  if (new Date(record.expires_at) < new Date()) return { ok: false, error: 'This code has expired. Request a new one.' };
  if (record.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };
  if (record.code_hash !== hashCode(email, String(code).trim())) {
    await db.query(`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1`, [record.id]);
    return { ok: false, error: 'Incorrect code. Please check and try again.' };
  }
  await db.query(`UPDATE verification_codes SET consumed_at = now() WHERE id = $1`, [record.id]);
  return { ok: true };
}

module.exports = { issueVerificationCode, verifyCode };

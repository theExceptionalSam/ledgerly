const { randomUUID, randomInt, createHash } = require('crypto');
const db = require('../db');

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

  console.log(`[OTP] Verification code for ${email}: ${code}`);

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
      console.error('[Email Error] Failed to send OTP email via Resend:', emailError.message);
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

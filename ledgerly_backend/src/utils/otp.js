const { randomUUID, randomInt, createHash } = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../db');

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function hashCode(email, code) {
  return createHash('sha256').update(`${email}:${code}`).digest('hex');
}

async function issueVerificationCode(tenantId, email) {
  const code = String(randomInt(0, 1000000)).padStart(6, '0');

  db.prepare(`DELETE FROM verification_codes WHERE tenant_id = ? AND email = ?`).run(tenantId, email);
  db.prepare(`
    INSERT INTO verification_codes (id, tenant_id, email, code_hash, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    tenantId,
    email,
    hashCode(email, code),
    new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()
  );

  console.log(`[OTP] Verification code for ${email}: ${code}`);

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      await transporter.sendMail({
        from: `"Ledgerly" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Your Ledgerly Verification Code',
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto">
            <h2>Verify your email</h2>
            <p>Your verification code is:</p>
            <h1 style="letter-spacing:8px;color:#4F46E5">${code}</h1>
            <p>This code expires in ${OTP_TTL_MINUTES} minutes.</p>
            <p>If you didn't request this, ignore this email.</p>
          </div>
        `,
      });
    } catch (emailError) {
      console.error('[Email Error] Failed to send OTP email:', emailError.message);
      // Don't crash the server, just log the error. The OTP is still printed in the logs above.
    }
  }

  return code;
}

function verifyCode(tenantId, email, code) {
  const record = db.prepare(
    `SELECT * FROM verification_codes WHERE tenant_id = ? AND email = ? AND consumed_at IS NULL`
  ).get(tenantId, email);
  if (!record) return { ok: false, error: 'No verification code found. Request a new one.' };
  if (new Date(record.expires_at) < new Date()) return { ok: false, error: 'This code has expired. Request a new one.' };
  if (record.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };
  if (record.code_hash !== hashCode(email, String(code).trim())) {
    db.prepare(`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?`).run(record.id);
    return { ok: false, error: 'Incorrect code. Please check and try again.' };
  }
  db.prepare(`UPDATE verification_codes SET consumed_at = datetime('now') WHERE id = ?`).run(record.id);
  return { ok: true };
}

module.exports = { issueVerificationCode, verifyCode };

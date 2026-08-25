const { randomUUID, randomInt, createHash } = require('crypto');
const db = require('../db');

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function hashCode(email, code) {
  return createHash('sha256').update(`${email}:${code}`).digest('hex');
}

// Issues a 6-digit verification code for a school's email. Only the hash is
// stored. In development (no mail transport configured yet) the code is
// logged to the server console and returned to the caller so testing works.
function issueVerificationCode(tenantId, email) {
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
  console.log(`[OTP] Verification code for ${email}: ${code} (valid ${OTP_TTL_MINUTES} minutes)`);
  return code;
}

// Returns { ok, error } — verifies the code, burns it on success, and counts
// attempts to stop brute-force guessing.
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

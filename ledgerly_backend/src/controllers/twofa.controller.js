const { authenticator } = require('otplib');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Two-factor authentication (TOTP, RFC 6238).
//
// setup: generates a per-user TOTP secret, stores it on the user row (twofa_enabled
// still 0 — the secret is "pending" until verify() succeeds). Returns the secret +
// an otpauth:// URI that the front end renders as a QR code (e.g. via qrcode.js).
//
// verify: checks the user-entered 6-digit code against the stored secret; on
// success, sets twofa_enabled = 1.
//
// disable: re-checks the code, then clears both the secret and the flag.
//
// The secret is stored in plaintext — TOTP secrets are not password-equivalent
// (they require the user's authenticator app to produce a valid code), so encrypting
// them at rest is not strictly required. If your threat model demands it, wrap the
// secret with a KMS-managed key before storing.

async function setup(req, res) {
  const { id: userId, tenantId } = req.user;

  // Guard against re-setup on already-enabled accounts: clicking "Enable 2FA"
  // when 2FA is already on would silently rotate the secret and lock the user
  // out of their authenticator app. They must disable first.
  const { rows: checkRows } = await db.query(`SELECT twofa_enabled FROM users WHERE id = $1 AND tenant_id = $2`, [userId, tenantId]);
  if (checkRows[0]?.twofa_enabled) {
    return res.status(409).json({ error: '2FA is already enabled. Disable it first if you want to set up a new device.' });
  }

  const secret = authenticator.generateSecret();
  await db.query(`UPDATE users SET twofa_secret = $1 WHERE id = $2 AND tenant_id = $3`, [secret, userId, tenantId]);

  const { rows } = await db.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  const email = rows[0]?.email || 'user';
  // keyuri builds an otpauth:// URI compatible with Google Authenticator, Authy, etc.
  const qrCodeUrl = authenticator.keyuri(email, 'Ledgerly', secret);
  res.json({ secret, qrCodeUrl });
}

async function verify(req, res) {
  const { id: userId, tenantId } = req.user;
  const { token } = req.body;

  const { rows } = await db.query(`SELECT twofa_secret, twofa_enabled FROM users WHERE id = $1 AND tenant_id = $2`, [userId, tenantId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.twofa_secret) return res.status(400).json({ error: 'Setup 2FA first' });
  if (user.twofa_enabled) return res.status(400).json({ error: '2FA is already enabled' });

  const ok = authenticator.verify({ token, secret: user.twofa_secret });
  if (!ok) return res.status(400).json({ error: 'Invalid verification code' });

  await db.query(`UPDATE users SET twofa_enabled = 1 WHERE id = $1 AND tenant_id = $2`, [userId, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'user', entityId: userId, ipAddress: req.ip, metadata: { twofaEnabled: true } });
  res.json({ ok: true });
}

async function disable(req, res) {
  const { id: userId, tenantId } = req.user;
  const { token } = req.body;

  const { rows } = await db.query(`SELECT twofa_secret, twofa_enabled FROM users WHERE id = $1 AND tenant_id = $2`, [userId, tenantId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.twofa_enabled) return res.status(400).json({ error: '2FA is not enabled' });

  const ok = authenticator.verify({ token, secret: user.twofa_secret });
  if (!ok) return res.status(400).json({ error: 'Invalid verification code' });

  await db.query(`UPDATE users SET twofa_enabled = 0, twofa_secret = NULL WHERE id = $1 AND tenant_id = $2`, [userId, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'user', entityId: userId, ipAddress: req.ip, metadata: { twofaEnabled: false } });
  res.json({ ok: true });
}

module.exports = { setup, verify, disable };

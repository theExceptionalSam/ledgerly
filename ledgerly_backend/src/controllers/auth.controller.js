const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signAccessToken, newRefreshToken, hashRefreshToken } = require('../utils/tokens');
const { recordAudit } = require('../utils/audit');
const { issueVerificationCode, verifyCode } = require('../utils/otp');

// Explicit opt-in for dev OTP exposure. NODE_ENV=production with a preview
// environment should NEVER leak OTPs — only this explicit flag does.
const showDevOtp = process.env.LEDGERLY_DEV_SHOW_OTP === 'true';

const REFRESH_COOKIE = 'refresh_token';
const isProd = process.env.NODE_ENV === 'production';
// sameSite 'lax' prevents CSRF on the refresh endpoint while still allowing
// top-level navigations. 'none' (previous) allowed any site to trigger refresh.
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'lax' : 'strict',
  path: '/api/v1/auth',
  maxAge: 1000 * 60 * 60 * 24 * 30,
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Issues a fresh access token + refresh token (rotated), stores the refresh
// token hash, and sets the refresh cookie. Now async because the refresh-token
// insert goes through the async pg client. Callers MUST await this.
async function issueSession(res, user) {
  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = newRefreshToken();

  await db.query(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES ($1, $2, $3, $4)
  `, [randomUUID(), user.id, hash, expiresAt]);

  res.cookie(REFRESH_COOKIE, raw, cookieOptions);
  return accessToken;
}

// Registers a new school (tenant) with its first user as owner.
// No session is issued yet — the school's email must be verified with the
// OTP that is generated here first.
async function registerSchool(req, res) {
  const { schoolName, ownerName, phone, email, password } = req.body;

  const { rows } = await db.query(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]);
  if (rows[0]) return res.status(409).json({ error: 'An account with this email already exists' });

  const tenantId = randomUUID();
  const userId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);

  await db.transaction(async (client) => {
    await db.query(`INSERT INTO tenants (id, name, phone) VALUES ($1, $2, $3)`, [tenantId, schoolName, phone], client);
    await db.query(`
      INSERT INTO users (id, tenant_id, name, email, password_hash, role)
      VALUES ($1, $2, $3, $4, $5, 'owner')
    `, [userId, tenantId, ownerName, email.toLowerCase(), passwordHash], client);
    // Every new school starts with a default academic session containing
    // three terms (First, Second, Third), with First Term set as current.
    const sessionId = randomUUID();
    await db.query(`
      INSERT INTO academic_sessions (id, tenant_id, name, is_current)
      VALUES ($1, $2, 'First Session', 1)
    `, [sessionId, tenantId], client);
    const termNames = ['First Term', 'Second Term', 'Third Term'];
    for (let i = 0; i < termNames.length; i++) {
      await db.query(`
        INSERT INTO terms (id, tenant_id, session_id, name, is_current)
        VALUES ($1, $2, $3, $4, $5)
      `, [randomUUID(), tenantId, sessionId, termNames[i], i === 0 ? 1 : 0], client);
    }
    // Seed the default fee head catalogue, matching migration 002's seed for
    // pre-existing tenants. New tenants get the same starting set.
    const seedHeads = ['Tuition', 'Boarding', 'Feeding', 'Development Levy', 'Exam Fees', 'Sports', 'Uniform'];
    for (const head of seedHeads) {
      await db.query(`INSERT INTO fee_heads (id, tenant_id, name) VALUES ($1, $2, $3)`, [randomUUID(), tenantId, head], client);
    }
  });

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'tenant', entityId: tenantId, ipAddress: req.ip });

  const code = await issueVerificationCode(tenantId, email.toLowerCase());
  res.status(201).json({
    verificationRequired: true,
    email: email.toLowerCase(),
    // Only exposed when LEDGERLY_DEV_SHOW_OTP=true — never in production.
    ...(showDevOtp ? { devCode: code } : {}),
  });
}

// Verifies the OTP sent at registration and issues the first session.
async function verifyOtp(req, res) {
  const { email, code } = req.body;
  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  const user = rows[0];
  // Generic error to avoid user enumeration — same shape whether or not the email exists.
  if (!user) return res.status(400).json({ error: 'Invalid or expired verification code' });

  const result = await verifyCode(user.tenant_id, email.toLowerCase(), code);
  if (!result.ok) return res.status(400).json({ error: result.error });

  await db.query(`UPDATE users SET email_verified = 1 WHERE id = $1`, [user.id]);
  await recordAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'update', entityType: 'user', entityId: user.id, ipAddress: req.ip, metadata: { emailVerified: true } });

  const accessToken = await issueSession(res, user);
  const { rows: tenantRows } = await db.query(`SELECT name FROM tenants WHERE id = $1`, [user.tenant_id]);
  res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id, emailVerified: true }, schoolName: tenantRows[0]?.name || '' });
}

async function resendOtp(req, res) {
  const { email } = req.body;
  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  const user = rows[0];
  // Generic response — does not reveal whether the email is registered.
  if (user) await issueVerificationCode(user.tenant_id, email.toLowerCase());
  res.json({ ok: true });
}

async function login(req, res) {
  const { email, password } = req.body;
  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  const user = rows[0];

  // Constant-shaped response whether the user exists or not, to avoid user enumeration
  const genericError = () => res.status(401).json({ error: 'Incorrect email or password' });

  if (!user) return genericError();

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(423).json({ error: 'Account temporarily locked due to repeated failed attempts. Try again later.' });
  }
  if (user.status === 'disabled') return res.status(403).json({ error: 'This account has been disabled' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const failedCount = user.failed_login_count + 1;
    const lockedUntil = failedCount >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
      : null;
    await db.query(`UPDATE users SET failed_login_count = $1, locked_until = $2 WHERE id = $3`, [failedCount, lockedUntil, user.id]);
    await recordAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'login_failed', entityType: 'user', entityId: user.id, ipAddress: req.ip });
    return genericError();
  }

  await db.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [user.id]);
  await recordAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'login', entityType: 'user', entityId: user.id, ipAddress: req.ip });

  // An unverified school must confirm its email before it can sign in.
  // Issuing a code here invalidates any earlier one, so the user always
  // verifies with the most recently sent code.
  if (!user.email_verified) {
    const code = await issueVerificationCode(user.tenant_id, user.email);
    return res.status(403).json({
      error: 'Please verify your school email before signing in.',
      verificationRequired: true,
      email: user.email,
      ...(showDevOtp ? { devCode: code } : {}),
    });
  }

  const accessToken = await issueSession(res, user);
  // Include tenant name so the frontend doesn't need an extra /auth/me call.
  const { rows: tenantRows } = await db.query(`SELECT name FROM tenants WHERE id = $1`, [user.tenant_id]);
  res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id, emailVerified: true }, schoolName: tenantRows[0]?.name || '' });
}

async function refresh(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) return res.status(401).json({ error: 'No active session' });

  const hash = hashRefreshToken(raw);
  const { rows: tokenRows } = await db.query(`SELECT * FROM refresh_tokens WHERE token_hash = $1`, [hash]);
  const record = tokenRows[0];

  if (!record || record.revoked_at || new Date(record.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }

  const { rows: userRows } = await db.query(`SELECT * FROM users WHERE id = $1`, [record.user_id]);
  const user = userRows[0];
  if (!user || user.status === 'disabled') return res.status(401).json({ error: 'Session no longer valid' });

  // Rotate: revoke the used refresh token and issue a new one (prevents replay of stolen tokens)
  await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [record.id]);
  const accessToken = await issueSession(res, user);
  res.json({ accessToken });
}

// --- Password reset flow ---
async function forgotPassword(req, res) {
  const { email } = req.body;
  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  const user = rows[0];
  // Always return ok — never reveal whether the email is registered.
  if (!user) return res.json({ ok: true });

  const token = randomUUID() + randomUUID();
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await db.query(`
    INSERT INTO verification_codes (id, tenant_id, email, code_hash, expires_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [randomUUID(), user.tenant_id, email.toLowerCase(), tokenHash, expiresAt]);

  console.log(`[Password Reset] Token for ${email}: ${token}`);
  // TODO: email the token via Resend once a verified domain is configured.

  res.json({ ok: true, ...(showDevOtp ? { devToken: token } : {}) });
}

async function resetPassword(req, res) {
  const { email, token, password } = req.body;
  const tokenHash = hashRefreshToken(token);
  const { rows } = await db.query(`
    SELECT * FROM verification_codes
    WHERE email = $1 AND code_hash = $2 AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `, [email.toLowerCase(), tokenHash]);
  const record = rows[0];
  if (!record || new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const { rows: userRows } = await db.query(`SELECT * FROM users WHERE email = $1 AND tenant_id = $2`, [email.toLowerCase(), record.tenant_id]);
  const user = userRows[0];
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

  const passwordHash = await bcrypt.hash(password, 12);
  await db.transaction(async (client) => {
    await db.query(`UPDATE users SET password_hash = $1, failed_login_count = 0, locked_until = NULL WHERE id = $2`, [passwordHash, user.id], client);
    await db.query(`UPDATE verification_codes SET consumed_at = now() WHERE id = $1`, [record.id], client);
    // Revoke all existing refresh tokens so active sessions are forced to re-login.
    await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [user.id], client);
  });
  await recordAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'update', entityType: 'user', entityId: user.id, ipAddress: req.ip, metadata: { passwordReset: true } });
  res.json({ ok: true });
}

async function logout(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) {
    const hash = hashRefreshToken(raw);
    await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [hash]);
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ ok: true });
}

// Revokes every session for the current user — "log out all devices"
async function logoutAll(req, res) {
  await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.user.id]);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ ok: true });
}

async function me(req, res) {
  const { rows: userRows } = await db.query(`SELECT id, name, email, role, tenant_id FROM users WHERE id = $1`, [req.user.id]);
  const user = userRows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { rows: tenantRows } = await db.query(`SELECT name FROM tenants WHERE id = $1`, [user.tenant_id]);
  const tenant = tenantRows[0];
  const { rows: termRows } = await db.query(`SELECT id, name FROM terms WHERE tenant_id = $1 AND is_current = 1`, [user.tenant_id]);
  const currentTerm = termRows[0];
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id },
    tenant,
    currentTerm: currentTerm || null,
  });
}

module.exports = { registerSchool, verifyOtp, resendOtp, login, refresh, logout, logoutAll, me, forgotPassword, resetPassword };

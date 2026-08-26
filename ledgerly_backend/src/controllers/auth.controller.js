const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signAccessToken, newRefreshToken, hashRefreshToken } = require('../utils/tokens');
const { recordAudit } = require('../utils/audit');
const { issueVerificationCode, verifyCode } = require('../utils/otp');

const isDev = process.env.NODE_ENV !== 'production';

const REFRESH_COOKIE = 'refresh_token';
const isProd = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'strict',
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
    // Every new school starts with a default current term so term-scoped
    // billing features work immediately, without requiring a manual setup step.
    await db.query(`
      INSERT INTO terms (id, tenant_id, name, is_current)
      VALUES ($1, $2, 'First Term', 1)
    `, [randomUUID(), tenantId], client);
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
    // Exposed only outside production so the flow is testable before a mail
    // transport is configured. In production it goes out by email only.
    ...(isDev ? { devCode: code } : {}),
  });
}

// Verifies the OTP sent at registration and issues the first session.
async function verifyOtp(req, res) {
  const { email, code } = req.body;
  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'No account found for this email' });

  const result = await verifyCode(user.tenant_id, email.toLowerCase(), code);
  if (!result.ok) return res.status(400).json({ error: result.error });

  await db.query(`UPDATE users SET email_verified = 1 WHERE id = $1`, [user.id]);
  await recordAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'update', entityType: 'user', entityId: user.id, ipAddress: req.ip, metadata: { emailVerified: true } });

  const accessToken = await issueSession(res, user);
  res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id, emailVerified: true } });
}

async function resendOtp(req, res) {
  const { email } = req.body;
  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'No account found for this email' });

  await issueVerificationCode(user.tenant_id, email.toLowerCase());
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
      ...(isDev ? { devCode: code } : {}),
    });
  }

  const accessToken = await issueSession(res, user);
  res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id, emailVerified: true } });
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
  const { rows: tenantRows } = await db.query(`SELECT name, term FROM tenants WHERE id = $1`, [user.tenant_id]);
  const tenant = tenantRows[0];
  const { rows: termRows } = await db.query(`SELECT id, name FROM terms WHERE tenant_id = $1 AND is_current = 1`, [user.tenant_id]);
  const currentTerm = termRows[0];
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id },
    tenant,
    currentTerm: currentTerm || null,
  });
}

module.exports = { registerSchool, verifyOtp, resendOtp, login, refresh, logout, logoutAll, me };

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
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: 1000 * 60 * 60 * 24 * 30,
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function issueSession(res, user) {
  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = newRefreshToken();

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(randomUUID(), user.id, hash, expiresAt);

  res.cookie(REFRESH_COOKIE, raw, cookieOptions);
  return accessToken;
}

// Registers a new school (tenant) with its first user as owner.
// No session is issued yet — the school's email must be verified with the
// OTP that is generated here first.
async function registerSchool(req, res) {
  const { schoolName, ownerName, phone, email, password } = req.body;

  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const tenantId = randomUUID();
  const userId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);

  const insertAll = db.transaction(() => {
    db.prepare(`INSERT INTO tenants (id, name, phone) VALUES (?, ?, ?)`).run(tenantId, schoolName, phone);
    db.prepare(`
      INSERT INTO users (id, tenant_id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?, 'owner')
    `).run(userId, tenantId, ownerName, email.toLowerCase(), passwordHash);
  });
  insertAll();

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'tenant', entityId: tenantId, ipAddress: req.ip });

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
function verifyOtp(req, res) {
  const { email, code } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase());
  if (!user) return res.status(404).json({ error: 'No account found for this email' });

  const result = verifyCode(user.tenant_id, email.toLowerCase(), code);
  if (!result.ok) return res.status(400).json({ error: result.error });

  db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(user.id);
  recordAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'update', entityType: 'user', entityId: user.id, ipAddress: req.ip, metadata: { emailVerified: true } });

  const accessToken = issueSession(res, user);
  res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id, emailVerified: true } });
}

async function resendOtp(req, res) {
  const { email } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase());
  if (!user) return res.status(404).json({ error: 'No account found for this email' });

  await issueVerificationCode(user.tenant_id, email.toLowerCase());
  res.json({ ok: true });
}

async function login(req, res) {
  const { email, password } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase());

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
    db.prepare(`UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?`)
      .run(failedCount, lockedUntil, user.id);
    recordAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'login_failed', entityType: 'user', entityId: user.id, ipAddress: req.ip });
    return genericError();
  }

  db.prepare(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  recordAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'login', entityType: 'user', entityId: user.id, ipAddress: req.ip });

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

  const accessToken = issueSession(res, user);
  res.json({ accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id, emailVerified: true } });
}

function refresh(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) return res.status(401).json({ error: 'No active session' });

  const hash = hashRefreshToken(raw);
  const record = db.prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`).get(hash);

  if (!record || record.revoked_at || new Date(record.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(record.user_id);
  if (!user || user.status === 'disabled') return res.status(401).json({ error: 'Session no longer valid' });

  // Rotate: revoke the used refresh token and issue a new one (prevents replay of stolen tokens)
  db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`).run(record.id);
  const accessToken = issueSession(res, user);
  res.json({ accessToken });
}

function logout(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) {
    const hash = hashRefreshToken(raw);
    db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE token_hash = ?`).run(hash);
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ ok: true });
}

// Revokes every session for the current user — "log out all devices"
function logoutAll(req, res) {
  db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(req.user.id);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ ok: true });
}

function me(req, res) {
  const user = db.prepare(`SELECT id, name, email, role, tenant_id FROM users WHERE id = ?`).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const tenant = db.prepare(`SELECT name, term FROM tenants WHERE id = ?`).get(user.tenant_id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenant_id }, tenant });
}

module.exports = { registerSchool, verifyOtp, resendOtp, login, refresh, logout, logoutAll, me };

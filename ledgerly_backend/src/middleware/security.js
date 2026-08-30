const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',');

const corsMiddleware = cors({
  origin: (origin, callback) => {
    // allow same-origin/non-browser requests (no origin header) and configured origins only
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not permitted by CORS policy'));
  },
  credentials: true,
});

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
});

// Strict limiter for authentication endpoints — slows down credential stuffing and brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait before trying again.' },
});

// Looser general limiter for the rest of the API
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Per-plan rate limits (requests per minute). The free tier is intentionally
// lower than the old global limit (60 vs 120) so unauthenticated / un-subscribed
// tenants can't hammer the API; paying tenants get progressively higher limits.
const PLAN_LIMITS = {
  free: 60,
  starter: 120,
  standard: 300,
  premium: 600,
  enterprise: 1200,
};

// Lazy-load db here to avoid a circular require: security.js is required early
// in server.js (before ./db is fully wired up in tests that mock the pool).
// In production the require resolves to the same singleton either way.
function getDb() {
  return require('../db');
}

// Dynamic per-tenant rate limiter — runs AFTER requireAuth on authenticated
// routes (see src/server.js), so req.user.tenantId is available for logged-in
// users. For unauthenticated requests (login, register, refresh) req.user is
// undefined → keyGenerator falls back to req.ip and max() returns the free tier.
//
// `max` (express-rate-limit v7 supports async functions for it; v7 also accepts
// `limit` as the new name with `max` kept as a deprecated alias — we use `max`
// for parity with the other limiters above) returns the per-tenant limit by
// looking up the tenant's active subscription plan. Falls back to free tier
// (60/min) on any DB error or unknown/missing plan — fail-open to keep the API
// usable when the subscriptions table is briefly unreachable.
const tenantRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: async (req) => {
    if (!req.user?.tenantId) return PLAN_LIMITS.free;
    try {
      const { rows } = await getDb().query(
        `SELECT plan FROM subscriptions WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
        [req.user.tenantId]
      );
      const plan = rows[0]?.plan || 'free';
      return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    } catch {
      // DB unreachable — fall back to the most restrictive tier so a tenant
      // can't accidentally bypass their quota during a DB blip.
      return PLAN_LIMITS.free;
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Your plan allows a limited number of requests per minute. Upgrade for a higher limit.' },
  // Each tenant gets its own counter; unauthenticated requests are keyed by IP
  // (req.user is undefined). This means a single noisy tenant can't exhaust
  // the limit for another tenant sharing the same NAT/proxy IP.
  keyGenerator: (req) => req.user?.tenantId || req.ip,
});

// Export limiter — prevents bulk data scraping (5 per minute per IP)
const exportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.tenantId || req.ip,
  message: { error: 'Too many exports. Please wait a minute before exporting again.' },
});

module.exports = { corsMiddleware, securityHeaders, authLimiter, apiLimiter, exportLimiter, tenantRateLimiter, PLAN_LIMITS };

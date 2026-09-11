const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);

const corsMiddleware = cors({
  origin: (origin, callback) => {
    // allow same-origin/non-browser requests (no origin header)
    if (!origin) return callback(null, true);
    // allow explicitly configured origins
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // allow any *.vercel.app origin (Vercel preview/production deployments)
    // Handles Vercel URL renames and preview deployments without needing to
    // update CORS_ORIGINS on Render each time.
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return callback(null, true);
    return callback(new Error('Origin not permitted by CORS policy'));
  },
  credentials: true,
});

// Helmet configuration — defense-in-depth HTTP security headers.
//
// Notes on the directive choices:
//   * defaultSrc 'self'         — only allow resources from our own origin by default.
//   * scriptSrc 'self'          — no inline scripts, no eval, no external CDNs. The
//                                  API serves JSON, not HTML, so there's no legit
//                                  need for inline scripts.
//   * styleSrc 'self' 'unsafe-inline' — inline styles are needed for the Swagger UI
//                                  (it injects <style> tags). 'unsafe-inline' for
//                                  styles is low-risk (CSS can't execute JS).
//   * imgSrc 'self' data:       — allow data: URIs for inline images (logo_data_url
//                                  on tenants is stored as a data URI).
//   * objectSrc 'none'          — block <object>/<embed>/<applet> (Flash/Java plugins).
//   * frameAncestors 'none'     — prevent the API responses from being framed
//                                  (clickjacking). Combined with X-Frame-Options: DENY
//                                  below for legacy-browser support.
//   * baseUri 'self'            — prevent <base> tag hijacking.
//   * formAction 'self'         — prevent forms from submitting to external origins.
//   * reportUri '/api/csp-report' — browsers POST violation reports here. Enforced
//                                  (reportOnly: false) — violations are blocked AND
//                                  reported. The endpoint is in src/server.js.
//
// `reportOnly: false` is the default; stating it explicitly documents that we
// want violations BLOCKED, not just reported.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      reportUri: ['/api/csp-report'],
    },
    reportOnly: false,
  },
  // COOP: same-origin — isolates the browsing-context group so a popup opened by
  // an attacker can't reference `window.opener` (prevents window-control attacks
  // like tabnabbing and some Spectre-style cross-origin reads).
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  // CORP: cross-origin — needed because receipt PDFs and exported files are
  // downloaded cross-origin (Vercel frontend → Render backend). 'cross-origin'
  // allows other origins to load the resources; 'same-origin' would break
  // downloads when the frontend is on a different domain.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // Referrer-Policy: no-referrer — never leak the full URL (which may contain
  // tokens in the query string, e.g. ?token=xxx for Swagger) to external sites
  // via the Referer header.
  referrerPolicy: { policy: 'no-referrer' },
  // HSTS — force HTTPS for 1 year, including subdomains, with preload. The
  // preload directive opts the domain into the browser HSTS preload list (so
  // even the FIRST visit uses HTTPS). Submit the domain at
  // https://hstspreload.org after deploying. 1 year is the recommended max-age;
  // don't go lower than 6 months (browsers treat short max-ages as
  // non-preloadable).
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  // X-Content-Type-Options: nosniff — prevent MIME-type sniffing (browsers
  // sometimes sniff a response as HTML/JS even if the Content-Type says
  // otherwise, which can lead to XSS if user-controlled bytes are served).
  noSniff: true,
  // X-Frame-Options: DENY — redundant with CSP frameAncestors 'none' but kept
  // for legacy browsers (IE11, old Android WebViews) that don't understand
  // CSP frame-ancestors.
  frameguard: { action: 'deny' },
  // Remove the X-Powered-By header (default Express sets it to "Express",
  // which fingerprints the server version for attackers).
  hidePoweredBy: true,
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

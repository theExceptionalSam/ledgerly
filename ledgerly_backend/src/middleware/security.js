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
  max: 10,
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

// Phase 5: bulk reminder rate limiter — max 3 bulk sends per hour per tenant,
// to prevent runaway SMS costs from a mis-click. Keyed on tenant identity.
const bulkReminderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.tenantId || req.ip,
  message: { error: 'Bulk reminder limit reached (3 per hour). Please wait before sending again.' },
});

module.exports = { corsMiddleware, securityHeaders, authLimiter, apiLimiter, bulkReminderLimiter };

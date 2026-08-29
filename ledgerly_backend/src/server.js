require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const { corsMiddleware, securityHeaders, apiLimiter, tenantRateLimiter } = require('./middleware/security');
const { errorHandler } = require('./middleware/validate');
const { requirePasswordNotForced } = require('./middleware/auth');
const { specs, swaggerUi } = require('./utils/swagger');
const db = require('./db');
const logger = require('./utils/logger');

// --- Sentry (optional, env-gated) ---
let Sentry;
if (process.env.SENTRY_DSN) {
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
  logger.info('Sentry initialized');
}

// --- Existing routes ---
const authRoutes = require('./routes/auth.routes');
const studentRoutes = require('./routes/students.routes');
const paymentRoutes = require('./routes/payments.routes');
const transactionRoutes = require('./routes/transactions.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const auditRoutes = require('./routes/audit.routes');
const termsRoutes = require('./routes/terms.routes');
const feeHeadRoutes = require('./routes/fee-heads.routes');
const sessionsRoutes = require('./routes/sessions.routes'); // academic sessions
const userRoutes = require('./routes/users.routes');
const reportsRoutes = require('./routes/reports.routes');
const brandingRoutes = require('./routes/branding.routes');
const platformRoutes = require('./routes/platform.routes');

// --- New Wave 1-7 routes ---
const paymentsOnlineRoutes = require('./routes/payments_online.routes');
const subscriptionsRoutes = require('./routes/subscriptions.routes');
const parentsRoutes = require('./routes/parents.routes');
const twofaRoutes = require('./routes/twofa.routes');
const apikeysRoutes = require('./routes/apikeys.routes');
const authSessionsRoutes = require('./routes/authSessions.routes');
const bankreconRoutes = require('./routes/bankrecon.routes');
const termclosingRoutes = require('./routes/termclosing.routes');
const feetemplatesRoutes = require('./routes/feetemplates.routes');
const paymentplansRoutes = require('./routes/paymentplans.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const searchRoutes = require('./routes/search.routes');
const webhooksRoutes = require('./routes/webhooks.routes');
const cronRoutes = require('./routes/cron.routes');
const datarequestsRoutes = require('./routes/datarequests.routes');
const settingsRoutes = require('./routes/settings.routes');
const receiptsRoutes = require('./routes/receipts.routes');

const app = express();

app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Use morgan for HTTP request logging, piped through pino in production
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api/', apiLimiter);

// Per-request timeout — if a handler takes >15s, respond 503 instead of hanging
// the client. Belt-and-suspenders: most handlers complete in <500ms, but a slow
// DB query or a stuck external call shouldn't tie up a connection indefinitely.
app.use((req, res, next) => {
  res.setTimeout(15000, () => {
    if (!res.headersSent) res.status(503).json({ error: 'Request timeout' });
  });
  next();
});

// Deepened health check — verifies the DB pool can serve a query, not just that
// the process is alive. Used by the load balancer to drain traffic on DB issues.
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: true, uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'degraded', db: false });
  }
});

// --- Public routes (before requirePasswordNotForced) ---
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/parents', parentsRoutes);
app.use('/api/v1/cron', cronRoutes); // FIXED: was '/api/v1' which intercepted ALL routes

app.use(requirePasswordNotForced);

// Per-tenant rate limiter — runs AFTER requirePasswordNotForced but BEFORE the
// authenticated route handlers, so it can read req.user (set by requireAuth on
// each individual route). Falls back to free-tier + IP keying for unauthenticated
// requests (req.user is undefined → keyGenerator returns req.ip, max returns
// PLAN_LIMITS.free). See src/middleware/security.js for plan limits.
app.use('/api/v1', tenantRateLimiter);

// --- Authenticated routes (after requirePasswordNotForced) ---
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/payments', paymentsOnlineRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/audit-logs', auditRoutes);
app.use('/api/v1/terms', termsRoutes);
app.use('/api/v1/terms', termclosingRoutes);
app.use('/api/v1/fee-heads', feeHeadRoutes);
app.use('/api/v1/sessions', sessionsRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/branding', brandingRoutes);
app.use('/api/v1/platform', platformRoutes);

// New Wave 1-7 protected routes
app.use('/api/v1/auth', twofaRoutes);
app.use('/api/v1/auth', authSessionsRoutes);
app.use('/api/v1/subscriptions', subscriptionsRoutes);
app.use('/api/v1/api-keys', apikeysRoutes);
app.use('/api/v1/bank-reconciliation', bankreconRoutes);
app.use('/api/v1/fee-templates', feetemplatesRoutes);
app.use('/api/v1/payment-plans', paymentplansRoutes);
app.use('/api/v1/notifications', notificationsRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/webhooks', webhooksRoutes);
app.use('/api/v1/data-requests', datarequestsRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/receipts', receiptsRoutes);

// Swagger UI — API documentation. Mounted after all routes so it doesn't
// shadow any real /api/docs endpoint, and before the 404 handler so the UI
// itself responds 200 (instead of falling through to "Not found").
// No auth — the spec contains no secrets (just request/response shapes).
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs, { explorer: true }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Sentry error handler must be before the custom error handler
if (Sentry) app.use(Sentry.Handlers.errorHandler());
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
let server;

db.ready.then(() => {
  server = app.listen(PORT, () => logger.info({ port: PORT, msg: 'API listening' }));
}).catch((err) => {
  logger.error({ err: err.message, msg: 'Database initialization failed' });
  // Don't process.exit — the process will exit naturally when nothing keeps
  // the event loop alive (no server listening, no DB pool connections).
  // This allows CI to require() the module without crashing.
});

function shutdown(signal) {
  logger.info({ signal, msg: 'Shutting down' });
  if (server) {
    server.close(() => {
      db.pool.end().then(() => process.exit(0)).catch(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 10000).unref();
  } else {
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;

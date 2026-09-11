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
const reversalsRoutes = require('./routes/reversals.routes');
const agedDebtorsRoutes = require('./routes/aged-debtors.routes');
const budgetsRoutes = require('./routes/budgets.routes');
const dataExportRoutes = require('./routes/data-export.routes');
const reconciliationRoutes = require('./routes/reconciliation.routes');
const monitoringRoutes = require('./routes/monitoring.routes');
const carryOverRoutes = require('./routes/carry-over.routes');

const app = express();

app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(corsMiddleware);
// SECURITY: the `verify` hook stashes the raw body bytes on each request so the
// Paystack webhook handler can recompute the HMAC-SHA512 signature over the
// exact bytes Paystack sent (JSON.stringify of a parsed body would not be
// byte-identical to the original wire payload). The memory cost is one Buffer
// per in-flight request, bounded by the 100kb body limit below.
app.use(express.json({
  limit: '100kb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
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

// Uptime monitoring endpoint — for external monitors (UptimeRobot, Better
// Stack). Mounted before requirePasswordNotForced so it needs no auth (monitors
// can't authenticate). Returns only non-sensitive health data. Distinct from
// /health because it surfaces memory + response time for external dashboards
// and uses a different URL so the platform operator can route it to a separate
// monitor without affecting the load-balancer health check.
app.use('/api/monitoring', monitoringRoutes);

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
app.use('/api/v1/reversals', reversalsRoutes);
app.use('/api/v1/aged-debtors', agedDebtorsRoutes);
app.use('/api/v1/budgets', budgetsRoutes);
app.use('/api/v1/data-export', dataExportRoutes);
app.use('/api/v1/reconciliation', reconciliationRoutes);
app.use('/api/v1/carry-over', carryOverRoutes);

// Swagger UI — API documentation. Mounted after all routes so it doesn't
// shadow any real /api/docs endpoint, and before the 404 handler so the UI
// itself responds 200 (instead of falling through to "Not found").
//
// SECURITY: gated behind SWAGGER_ACCESS_TOKEN so the API contract (endpoint
// shapes, request/response schemas) isn't publicly discoverable. Fail-closed:
// if the env var is unset, ALL requests are rejected with 401. Access via:
//   * query param ?token=xxx   (bookmarkable, used by the Swagger UI itself)
//   * Authorization: Bearer xxx (for API tools / programmatic access)
// The token is shared with the platform operator — set it to a random secret
// in production (e.g. `openssl rand -hex 32`).
app.use('/api/docs', (req, res, next) => {
  const token = req.query.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.SWAGGER_ACCESS_TOKEN || token !== process.env.SWAGGER_ACCESS_TOKEN) {
    return res.status(401).type('text').send('API docs are protected. Add ?token=YOUR_TOKEN to the URL.');
  }
  next();
}, swaggerUi.serve, swaggerUi.setup(specs, { explorer: true }));

// CSP violation reporting endpoint — browsers POST violation reports here when
// a `report-uri` / `report-to` directive is set in the Content-Security-Policy
// header (see src/middleware/security.js). Logged via the structured logger so
// violations are searchable in the log aggregator; not acted on automatically.
// Could integrate with Sentry in the future via `Sentry.captureMessage`.
// Uses a dedicated body parser with `type: 'application/csp-report'` because
// the global `express.json()` middleware only parses `application/json`.
app.post('/api/csp-report', express.json({ type: 'application/csp-report', limit: '64kb' }), (req, res) => {
  logger.warn({ msg: 'CSP violation', report: req.body });
  res.status(204).end();
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Sentry error handler must be before the custom error handler.
// @sentry/node v10+ uses setupExpressErrorHandler(app) instead of the old
// Handlers.errorHandler() / Handlers.requestHandler() pattern. This sets up
// both the request handler (adds tracing context) and the error handler
// (captures unhandled errors) in one call.
if (Sentry) Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
let server;

// In test mode (NODE_ENV=test), skip binding a real port — supertest spins up
// its own ephemeral server per request, and binding port 4000 here would leave
// a dangling listener that prevents Jest from exiting. Also skip db.init so the
// test process doesn't try to connect to a (nonexistent) DB and spam the logs.
// Tests mock the db module via tests/jest.setup.js instead.
if (process.env.NODE_ENV !== 'test') {
  // Start the server immediately — don't wait for db.ready. The health endpoint
  // will report 'degraded' until the DB connects, and individual endpoints will
  // return 500 if the DB is unreachable. This prevents Render from crash-looping
  // on cold starts where the DB connection takes longer than expected.
  // The db.ready promise (with retries) resolves in the background; once it does,
  // all endpoints work normally.
  server = app.listen(PORT, () => logger.info({ port: PORT, msg: 'API listening' }));

  db.ready.then(() => {
    logger.info({ msg: 'Database initialized — all endpoints ready' });
  }).catch((err) => {
    logger.error({ err: err.message, msg: 'Database initialization failed after retries' });
    // Don't process.exit — keep the server running so Render doesn't crash-loop.
    // The health endpoint will return 503 (degraded), and individual endpoints
    // will return 500 (DATABASE_URL not configured / connection error).
    // Render's health check will mark the service as degraded but won't restart it.
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
}

module.exports = app;

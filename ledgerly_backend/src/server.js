require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const { corsMiddleware, securityHeaders, apiLimiter } = require('./middleware/security');
const { errorHandler } = require('./middleware/validate');
const { requirePasswordNotForced } = require('./middleware/auth');
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

const authRoutes = require('./routes/auth.routes');
const studentRoutes = require('./routes/students.routes');
const paymentRoutes = require('./routes/payments.routes');
const transactionRoutes = require('./routes/transactions.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const auditRoutes = require('./routes/audit.routes');
const termsRoutes = require('./routes/terms.routes');
const feeHeadRoutes = require('./routes/fee-heads.routes');
const sessionsRoutes = require('./routes/sessions.routes');
const userRoutes = require('./routes/users.routes');
const reportsRoutes = require('./routes/reports.routes');
const brandingRoutes = require('./routes/branding.routes');
const platformRoutes = require('./routes/platform.routes');

const app = express();

app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Use morgan for HTTP request logging, piped through pino in production
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api/', apiLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use(requirePasswordNotForced);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/audit-logs', auditRoutes);
app.use('/api/v1/terms', termsRoutes);
app.use('/api/v1/fee-heads', feeHeadRoutes);
app.use('/api/v1/sessions', sessionsRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/branding', brandingRoutes);
app.use('/api/v1/platform', platformRoutes);

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

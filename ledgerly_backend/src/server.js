require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const { corsMiddleware, securityHeaders, apiLimiter } = require('./middleware/security');
const { errorHandler } = require('./middleware/validate');
const db = require('./db');

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

const app = express();

// Trust the first proxy hop only (e.g. a load balancer) — needed for correct req.ip and rate limiting
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(morgan('combined'));
app.use('/api/', apiLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/audit-logs', auditRoutes);
app.use('/api/v1/terms', termsRoutes);
app.use('/api/v1/fee-heads', feeHeadRoutes);
app.use('/api/v1/sessions', sessionsRoutes);
app.use('/api/v1/users', userRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
let server;

db.ready.then(() => {
  server = app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
}).catch((err) => {
  console.error('[server] Could not start — database initialization failed:', err.message);
  process.exit(1);
});

// Graceful shutdown — stop accepting new connections and close the DB pool
// so in-flight requests finish cleanly on deploy/restart.
function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down...`);
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

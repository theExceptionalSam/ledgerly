require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const { corsMiddleware, securityHeaders, apiLimiter } = require('./middleware/security');
const { errorHandler } = require('./middleware/validate');

const authRoutes = require('./routes/auth.routes');
const studentRoutes = require('./routes/students.routes');
const paymentRoutes = require('./routes/payments.routes');
const transactionRoutes = require('./routes/transactions.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const auditRoutes = require('./routes/audit.routes');
const termsRoutes = require('./routes/terms.routes');
const feeHeadRoutes = require('./routes/fee-heads.routes');

const app = express();

// Trust the first proxy hop only (e.g. a load balancer) — needed for correct req.ip and rate limiting
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json({ limit: '100kb' })); // small limit — this API never needs large payloads
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

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API listening on port ${PORT}`));

module.exports = app;

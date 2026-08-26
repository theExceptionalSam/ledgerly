const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array().map(e => ({ field: e.path, message: e.msg })) });
  }
  next();
}

// Wrap async route handlers so rejected promises reach the error handler.
// Express 4 does NOT auto-catch async errors — without this, any DB error
// becomes an unhandled promise rejection and crashes the process.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Central error handler — never leaks stack traces or internal details.
function errorHandler(err, req, res, next) {
  // If headers already sent (e.g. during a streaming response), delegate to
  // Express's default handler — calling res.status() here would throw.
  if (res.headersSent) return next(err);
  console.error(`[${new Date().toISOString()}] ${err.message}`);
  if (err.message === 'Origin not permitted by CORS policy') {
    return res.status(403).json({ error: 'Origin not permitted' });
  }
  res.status(err.status || 500).json({ error: 'Something went wrong. Please try again.' });
}

module.exports = { validate, asyncHandler, errorHandler };

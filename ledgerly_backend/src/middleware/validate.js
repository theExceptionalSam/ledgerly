const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array().map(e => ({ field: e.path, message: e.msg })) });
  }
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  logger.error({ err: err.message, path: req.path, method: req.method, msg: 'Request error' });
  if (err.message === 'Origin not permitted by CORS policy') {
    return res.status(403).json({ error: 'Origin not permitted' });
  }
  res.status(err.status || 500).json({ error: 'Something went wrong. Please try again.' });
}

module.exports = { validate, asyncHandler, errorHandler };

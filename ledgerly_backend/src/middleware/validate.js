const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid input', details: errors.array().map(e => ({ field: e.path, message: e.msg })) });
  }
  next();
}

// Central error handler — never leaks stack traces or internal details to the client
function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ${err.message}`);
  if (err.message === 'Origin not permitted by CORS policy') {
    return res.status(403).json({ error: 'Origin not permitted' });
  }
  res.status(err.status || 500).json({ error: 'Something went wrong. Please try again.' });
}

module.exports = { validate, errorHandler };

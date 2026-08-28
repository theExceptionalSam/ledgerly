const pino = require('pino');

// Structured JSON logger for production, pretty-printed for dev.
// Pino is the fastest Node.js logger — zero overhead when not logging.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV !== 'production' ? {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  } : {}),
});

module.exports = logger;

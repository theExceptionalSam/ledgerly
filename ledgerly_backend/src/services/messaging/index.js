'use strict';

// Currently routes to Termii. Swap this file to change providers without touching callers.
const termii = require('./termii');

module.exports = {
  sendMessage: termii.sendMessage,
  normalizePhone: termii.normalizePhone,
};

const { Router } = require('express');
const { query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/reconciliation.controller');

const router = Router();

// End-of-day reconciliation is the bursar's primary cash-up tool, so all
// three financial roles can read it: the owner (oversight), the accountant
// (bookkeeping), and the bursar (daily cash-up). Assistants are excluded —
// they're data-entry-only and don't reconcile cash.
router.use(requireAuth, requireRole('owner', 'accountant', 'bursar'));

// GET /api/v1/reconciliation/daily?date=YYYY-MM-DD
// Returns the daily reconciliation report. ?date is optional (defaults to
// today UTC) and validated as ISO 8601 — isISO8601 accepts both full
// timestamps and bare dates, so "2025-01-15" passes. The controller slices
// to the first 10 chars, so even if a caller passes a full timestamp the
// query still uses just the date.
router.get('/daily', [
  query('date').optional().isISO8601(),
], validate, asyncHandler(ctrl.getDailyReconciliation));

module.exports = router;

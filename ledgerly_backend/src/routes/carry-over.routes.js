const { Router } = require('express');
const { body, query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/carry-over.controller');

// Carry-over outstanding balances from a closed term to a new (open) term.
// Owner-only — this is a financial control that mutates fee assignments in
// bulk, so it should only be triggered by the school owner (mirrors the
// term-close/reopen role gate in termclosing.routes.js).
const router = Router();
router.use(requireAuth, requireRole('owner'));

// POST /api/v1/carry-over
// Body: { sourceTermId, targetTermId }
// Idempotent: re-running after a partial failure skips students who already
// have a carry-over assignment in the target term.
router.post('/', [
  body('sourceTermId').isUUID(),
  body('targetTermId').isUUID(),
], validate, asyncHandler(ctrl.carryOverOutstanding));

// GET /api/v1/carry-over/preview?sourceTermId=...&targetTermId=...
// Returns the list of students who WOULD be carried over (no mutation).
router.get('/preview', [
  query('sourceTermId').isUUID(),
  query('targetTermId').isUUID(),
], validate, asyncHandler(ctrl.previewCarryOver));

module.exports = router;

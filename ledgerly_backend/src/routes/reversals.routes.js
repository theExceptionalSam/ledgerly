const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/reversals.controller');

const router = Router();
router.use(requireAuth);

// Any authenticated staff member can submit a reversal request. The role
// check (owner/accountant/bursar) lives in the controller so parents — who
// never reach this router because their tokens are rejected by requireAuth —
// are also excluded by an explicit guard (defence in depth).
router.post('/', [
  body('paymentId').isUUID(),
  body('reason').trim().isLength({ min: 3, max: 300 }),
], validate, asyncHandler(ctrl.requestReversal));

// Owner-only — list pending (or historical) reversal requests. Optional
// ?status=pending|approved|rejected|all query param; defaults to 'pending'.
router.get('/', requireRole('owner'), asyncHandler(ctrl.listReversalRequests));

// Owner-only — approve / reject a pending request. The :id is the
// reversal_requests.id (UUID), not the payment id.
router.post('/:id/approve', requireRole('owner'), [
  param('id').isUUID(),
], validate, asyncHandler(ctrl.approveReversal));

router.post('/:id/reject', requireRole('owner'), [
  param('id').isUUID(),
  body('rejectionReason').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
], validate, asyncHandler(ctrl.rejectReversal));

module.exports = router;

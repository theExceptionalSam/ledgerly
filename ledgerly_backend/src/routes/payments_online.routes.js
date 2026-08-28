const { Router } = require('express');
const { body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/payments_online.controller');

const router = Router();

// Webhook is PUBLIC (called by Paystack, no auth) — must be mounted before
// requirePasswordNotForced. The other two routes are staff-only.
router.post('/online/webhook', asyncHandler(ctrl.webhook));

router.post('/online/initiate', requireAuth, [
  body('studentId').isUUID(),
  body('amount').isFloat({ gt: 0 }),
  body('feeHeadId').optional().isUUID(),
  body('termId').optional().isUUID(),
  body('parentPhone').optional().trim().isLength({ max: 30 }),
], validate, asyncHandler(ctrl.initiate));

router.get('/online', requireAuth, asyncHandler(ctrl.listOnlinePayments));

module.exports = router;

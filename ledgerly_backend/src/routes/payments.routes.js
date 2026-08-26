const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/payments.controller');
const receiptsCtrl = require('../controllers/receipts.controller');

const router = Router();
router.use(requireAuth);

router.post('/', requireRole('owner', 'bursar', 'accountant'), [
  body('studentId').isUUID(),
  body('amount').isFloat({ gt: 0 }),
  body('method').optional().isIn(['cash', 'bank_transfer', 'pos', 'cheque', 'online']),
  body('note').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  body('paidOn').isISO8601(),
  body('idempotencyKey').optional().isLength({ max: 100 }),
  body('feeHeadId').isUUID(),
  body('termId').optional().isUUID(),
], validate, asyncHandler(ctrl.recordPayment));

router.post('/:id/reverse', requireRole('owner', 'accountant'), [
  param('id').isUUID(),
  body('reason').trim().isLength({ min: 3, max: 300 }),
], validate, asyncHandler(ctrl.reversePayment));

// Phase 3: receipt generation — any authenticated user can issue/print a receipt
router.get('/:paymentId/receipt', [param('paymentId').isUUID()], validate, asyncHandler(receiptsCtrl.issueReceipt));

module.exports = router;

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/payments.controller');
const receiptsCtrl = require('../controllers/receipts.controller');

const router = Router();
router.use(requireAuth);

// List payments (optional filters: studentId, feeHeadId, termId, from, to,
// method, reversed, unmatched, page, pageSize). Convention: list-before-create
// so the GET / route isn't shadowed by POST /.
router.get('/', [
  query('studentId').optional().isUUID(),
  query('feeHeadId').optional().isUUID(),
  query('termId').optional().isUUID(),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('method').optional().isIn(['cash', 'bank_transfer', 'pos', 'cheque', 'online']),
  query('reversed').optional().isInt({ min: 0, max: 1 }),
  query('unmatched').optional().isBoolean(),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 200 }),
], validate, asyncHandler(ctrl.listPayments));

router.post('/', requireRole('owner', 'bursar', 'accountant'), [
  body('studentId').isUUID(),
  body('amount').isFloat({ gt: 0 }),
  body('method').optional().isIn(['cash', 'bank_transfer', 'pos', 'cheque', 'online']),
  body('note').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  body('paidOn').isISO8601(),
  body('idempotencyKey').optional().isLength({ max: 200 }),
  body('feeHeadId').isUUID(),
  body('termId').optional().isUUID(),
], validate, asyncHandler(ctrl.recordPayment));

router.post('/:id/reverse', requireRole('owner', 'accountant'), [
  param('id').isUUID(),
  body('reason').trim().isLength({ min: 3, max: 300 }),
], validate, asyncHandler(ctrl.reversePayment));

// Phase 3: receipt generation — any authenticated user can issue/print a receipt
router.get('/:paymentId/receipt', [param('paymentId').isUUID()], validate, asyncHandler(receiptsCtrl.issueReceipt));

// Email a receipt to the student's guardian (if guardian_contact is an email)
router.post('/:paymentId/receipt/email', [param('paymentId').isUUID()], validate, asyncHandler(receiptsCtrl.emailReceipt));

module.exports = router;

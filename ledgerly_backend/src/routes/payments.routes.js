const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureFlag');
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

/**
 * @swagger
 * /payments:
 *   post:
 *     summary: Record a new payment for a student
 *     description: Idempotent (use `idempotencyKey` to prevent double-submission). Creates the payment, links it to a fee assignment, and issues a receipt atomically.
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, amount, paidOn, feeHeadId]
 *             properties:
 *               studentId:      { type: string, format: uuid }
 *               amount:         { type: number, exclusiveMinimum: 0 }
 *               method:         { type: string, enum: [cash, bank_transfer, pos, cheque, online] }
 *               note:           { type: string, maxLength: 300 }
 *               paidOn:         { type: string, format: date-time }
 *               idempotencyKey: { type: string, maxLength: 200 }
 *               feeHeadId:      { type: string, format: uuid }
 *               termId:         { type: string, format: uuid }
 *     responses:
 *       201: { description: Payment recorded — returns the payment + receipt }
 *       403: { description: Forbidden — role not allowed (owner/bursar/accountant only) }
 *       404: { description: Student / fee head / term not found }
 *       409: { description: Idempotency conflict }
 *       422: { description: Validation error }
 */
router.post('/', requireRole('owner', 'bursar', 'accountant'), [
  body('studentId').isUUID(),
  body('amount').isFloat({ gt: 0 }),
  body('method').optional().isIn(['cash', 'bank_transfer', 'pos', 'cheque', 'online']),
  body('note').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  body('paidOn').isISO8601(),
  body('idempotencyKey').optional().isLength({ max: 200 }),
  body('feeHeadId').isUUID(),
  body('termId').optional().isUUID(),
], validate, requireFeature('payments'), asyncHandler(ctrl.recordPayment));

router.post('/:id/reverse', requireRole('owner', 'accountant'), [
  param('id').isUUID(),
  body('reason').trim().isLength({ min: 3, max: 300 }),
], validate, asyncHandler(ctrl.reversePayment));

// Phase 3: receipt generation — any authenticated user can issue/print a receipt
router.get('/:paymentId/receipt', [param('paymentId').isUUID()], validate, asyncHandler(receiptsCtrl.issueReceipt));

// Email a receipt to the student's guardian (if guardian_contact is an email)
router.post('/:paymentId/receipt/email', [param('paymentId').isUUID()], validate, asyncHandler(receiptsCtrl.emailReceipt));

module.exports = router;

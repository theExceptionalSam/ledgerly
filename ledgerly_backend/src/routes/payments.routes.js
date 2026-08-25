const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/payments.controller');

const router = Router();
router.use(requireAuth);

router.post('/', requireRole('owner', 'bursar', 'accountant'), [
  body('studentId').isUUID(),
  body('amount').isFloat({ gt: 0 }),
  body('method').optional().isIn(['cash', 'bank_transfer', 'pos', 'cheque', 'online']),
  body('note').optional({ checkFalsy: true }).trim().isLength({ max: 300 }).escape(),
  body('paidOn').isISO8601(),
  body('idempotencyKey').optional().isLength({ max: 100 }),
], validate, ctrl.recordPayment);

router.post('/:id/reverse', requireRole('owner', 'accountant'), [
  param('id').isUUID(),
  body('reason').trim().isLength({ min: 3, max: 300 }).escape(),
], validate, ctrl.reversePayment);

module.exports = router;

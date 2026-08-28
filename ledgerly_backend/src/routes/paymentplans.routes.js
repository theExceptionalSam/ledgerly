const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/paymentplans.controller');

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listPlans));

router.post('/', requireRole('owner', 'accountant'), [
  body('studentId').isUUID(),
  body('feeHeadId').isUUID(),
  body('termId').isUUID(),
  body('totalAmount').isFloat({ gt: 0 }),
  body('installments').isInt({ min: 1, max: 12 }),
  body('dueDates').isArray(),
  body('lateFee').optional().isFloat({ min: 0 }),
], validate, asyncHandler(ctrl.createPlan));

router.get('/:id', [param('id').isUUID()], validate, asyncHandler(ctrl.getPlan));

module.exports = router;

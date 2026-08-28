const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/feetemplates.controller');

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listTemplates));

router.post('/', requireRole('owner', 'accountant'), [
  body('name').trim().isLength({ min: 1, max: 120 }),
  body('className').optional().trim().isLength({ max: 80 }),
  body('items').isArray({ min: 1 }),
  body('items.*.feeHeadId').isUUID(),
  body('items.*.expectedAmount').isFloat({ gt: 0 }),
], validate, asyncHandler(ctrl.createTemplate));

router.post('/:id/apply', requireRole('owner', 'accountant'), [
  param('id').isUUID(),
  body('studentIds').optional().isArray(),
  body('class').optional().trim().isLength({ min: 1, max: 80 }),
], validate, asyncHandler(ctrl.applyTemplate));

module.exports = router;

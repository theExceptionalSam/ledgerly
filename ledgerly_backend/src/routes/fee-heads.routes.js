const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/fee-heads.controller');

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listFeeHeads));

router.post('/', requireRole('owner', 'bursar'), [
  body('name').trim().isLength({ min: 1, max: 80 }),
], validate, asyncHandler(ctrl.createFeeHead));

router.post('/:id/deactivate', requireRole('owner', 'bursar'), [
  param('id').isUUID(),
], validate, asyncHandler(ctrl.deactivateFeeHead));

// Phase 4: bulk assign a fee head to every student in a class
router.post('/:id/bulk-assign', requireRole('owner', 'bursar'), [
  param('id').isUUID(),
  body('termId').isUUID(),
  body('class').trim().isLength({ min: 1, max: 60 }),
  body('expectedAmount').isFloat({ min: 0 }),
  body('overwriteExisting').optional().isBoolean(),
], validate, asyncHandler(ctrl.bulkAssign));

module.exports = router;

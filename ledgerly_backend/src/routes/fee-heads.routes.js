const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/fee-heads.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.listFeeHeads);

router.post('/', requireRole('owner', 'bursar'), [
  body('name').trim().isLength({ min: 1, max: 80 }).escape(),
], validate, ctrl.createFeeHead);

router.post('/:id/deactivate', requireRole('owner', 'bursar'), [
  param('id').isUUID(),
], validate, ctrl.deactivateFeeHead);

// Phase 4: bulk assign a fee head to every student in a class
router.post('/:id/bulk-assign', requireRole('owner', 'bursar'), [
  param('id').isUUID(),
  body('termId').isUUID(),
  body('class').trim().isLength({ min: 1, max: 60 }).escape(),
  body('expectedAmount').isFloat({ min: 0 }),
  body('overwriteExisting').optional().isBoolean(),
], validate, ctrl.bulkAssign);

module.exports = router;

const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/terms.controller');

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listTerms));

router.post('/', requireRole('owner', 'bursar'), [
  body('name').trim().isLength({ min: 1, max: 120 }),
  body('startDate').optional({ checkFalsy: true }).isISO8601(),
  body('endDate').optional({ checkFalsy: true }).isISO8601(),
  body('setCurrent').optional().isBoolean(),
  body('sessionId').optional().isUUID(),
], validate, asyncHandler(ctrl.createTerm));

router.put('/:id', requireRole('owner'), [
  param('id').isUUID(),
  body('name').trim().isLength({ min: 1, max: 120 }),
  body('startDate').optional({ checkFalsy: true }).isISO8601(),
  body('endDate').optional({ checkFalsy: true }).isISO8601(),
], validate, asyncHandler(ctrl.updateTerm));

router.delete('/:id', requireRole('owner'), [
  param('id').isUUID(),
], validate, asyncHandler(ctrl.deleteTerm));

router.post('/:id/set-current', requireRole('owner'), [
  param('id').isUUID(),
], validate, asyncHandler(ctrl.setCurrentTerm));

module.exports = router;

const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/terms.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.listTerms);

router.post('/', requireRole('owner', 'bursar'), [
  body('name').trim().isLength({ min: 1, max: 120 }).escape(),
  body('startDate').optional({ checkFalsy: true }).isISO8601(),
  body('endDate').optional({ checkFalsy: true }).isISO8601(),
  body('setCurrent').optional().isBoolean(),
], validate, ctrl.createTerm);

router.post('/:id/set-current', requireRole('owner'), [
  param('id').isUUID(),
], validate, ctrl.setCurrentTerm);

module.exports = router;

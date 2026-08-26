const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/sessions.controller');

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listSessions));

router.post('/', requireRole('owner'), [
  body('name').trim().isLength({ min: 1, max: 120 }),
  body('setCurrent').optional().isBoolean(),
], validate, asyncHandler(ctrl.createSession));

router.put('/:id', requireRole('owner'), [
  param('id').isUUID(),
  body('name').trim().isLength({ min: 1, max: 120 }),
], validate, asyncHandler(ctrl.updateSession));

router.delete('/:id', requireRole('owner'), [
  param('id').isUUID(),
], validate, asyncHandler(ctrl.deleteSession));

router.post('/:id/set-current', requireRole('owner'), [
  param('id').isUUID(),
], validate, asyncHandler(ctrl.setCurrentSession));

module.exports = router;

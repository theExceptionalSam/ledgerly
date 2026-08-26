const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/sessions.controller');

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.listSessions);

router.post('/', requireRole('owner'), [
  body('name').trim().isLength({ min: 1, max: 120 }).escape(),
  body('setCurrent').optional().isBoolean(),
], validate, ctrl.createSession);

router.put('/:id', requireRole('owner'), [
  param('id').isUUID(),
  body('name').trim().isLength({ min: 1, max: 120 }).escape(),
], validate, ctrl.updateSession);

router.delete('/:id', requireRole('owner'), [
  param('id').isUUID(),
], validate, ctrl.deleteSession);

router.post('/:id/set-current', requireRole('owner'), [
  param('id').isUUID(),
], validate, ctrl.setCurrentSession);

module.exports = router;

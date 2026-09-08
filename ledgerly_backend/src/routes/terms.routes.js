const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/terms.controller');
const termClosingCtrl = require('../controllers/termclosing.controller');

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

// Fiscal-period closure controls. Both are owner-only — closing the books and
// reopening a closed term are financial controls that the controller also
// double-checks. These routes live on the terms router so they share the
// `requireAuth` + UUID param validation of the other term endpoints. The
// same handlers are also registered on /api/v1/terms via termclosing.routes.js
// (mounted after this router) — that registration is harmless duplication;
// Express routes to the first match, which is this one.
router.post('/:id/close', requireRole('owner'), [
  param('id').isUUID(),
], validate, asyncHandler(termClosingCtrl.closeTerm));

router.post('/:id/reopen', requireRole('owner'), [
  param('id').isUUID(),
  body('reason').trim().isLength({ min: 3, max: 300 }),
], validate, asyncHandler(termClosingCtrl.reopenTerm));

module.exports = router;

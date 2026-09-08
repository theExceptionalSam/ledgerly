const { Router } = require('express');
const { param, body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/termclosing.controller');

const router = Router();
router.use(requireAuth, requireRole('owner'));

// Both close and reopen are owner-only — closing the books and reopening them
// are financial controls that the controller double-checks, so the route-level
// guard is defence-in-depth.
router.post('/:id/close', [param('id').isUUID()], validate, asyncHandler(ctrl.closeTerm));
router.post('/:id/reopen', [
  param('id').isUUID(),
  body('reason').trim().isLength({ min: 3, max: 300 }),
], validate, asyncHandler(ctrl.reopenTerm));

module.exports = router;

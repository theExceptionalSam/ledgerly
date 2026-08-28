const { Router } = require('express');
const { param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/termclosing.controller');

const router = Router();
router.use(requireAuth, requireRole('owner', 'accountant'));

// Close: owner or accountant. Reopen: owner only (the controller double-checks
// the role, so the route-level guard is a defence-in-depth backstop).
router.post('/:id/close', [param('id').isUUID()], validate, asyncHandler(ctrl.closeTerm));
router.post('/:id/reopen', requireRole('owner'), [param('id').isUUID()], validate, asyncHandler(ctrl.reopenTerm));

module.exports = router;

const { Router } = require('express');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/audit.controller');

const router = Router();
router.use(requireAuth, requireRole('owner'));
router.get('/', asyncHandler(ctrl.listAuditLogs));

module.exports = router;

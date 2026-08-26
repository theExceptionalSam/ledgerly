const { Router } = require('express');
const { body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/audit.controller');

const router = Router();
router.use(requireAuth, requireRole('owner'));

router.get('/', asyncHandler(ctrl.listAuditLogs));

router.post('/bulk-delete', [
  body('ids').optional().isArray(),
  body('before').optional().isISO8601(),
], validate, asyncHandler(ctrl.bulkDeleteAuditLogs));

module.exports = router;

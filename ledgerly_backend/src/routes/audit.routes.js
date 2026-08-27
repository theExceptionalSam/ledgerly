const { Router, query } = require('express');
const { body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/audit.controller');

const router = Router();
router.use(requireAuth, requireRole('owner'));

router.get('/', [
  query('search').optional().trim(),
  query('deleted').optional().isIn(['true', 'false']),
  query('limit').optional().isInt({ min: 1, max: 500 }),
], validate, asyncHandler(ctrl.listAuditLogs));

router.post('/bulk-delete', [
  body('ids').optional().isArray(),
  body('before').optional().isISO8601(),
], validate, asyncHandler(ctrl.bulkDeleteAuditLogs));

router.post('/restore', [
  body('ids').isArray({ min: 1 }),
], validate, asyncHandler(ctrl.restoreAuditLogs));

module.exports = router;

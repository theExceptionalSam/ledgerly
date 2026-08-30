const { Router } = require('express');
const { query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/reports.controller');

const router = Router();
router.use(requireAuth);

router.get('/', [
  query('termId').optional().isUUID(),
], validate, asyncHandler(ctrl.getReports));

module.exports = router;

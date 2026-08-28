const { Router } = require('express');
const { query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/receipts.controller');

const router = Router();
router.use(requireAuth);

// List receipts (optional filters: studentId, from, to, page, pageSize)
router.get('/', [
  query('studentId').optional().isUUID(),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 200 }),
], validate, asyncHandler(ctrl.listReceipts));

module.exports = router;

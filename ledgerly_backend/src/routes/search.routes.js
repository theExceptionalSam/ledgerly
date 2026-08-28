const { Router } = require('express');
const { query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/search.controller');

const router = Router();
router.use(requireAuth);

router.get('/search', [
  query('q').optional().trim().isLength({ max: 200 }),
], validate, asyncHandler(ctrl.search));

module.exports = router;

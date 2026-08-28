const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/validate');
const { getDashboard } = require('../controllers/dashboard.controller');

const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(getDashboard));

module.exports = router;

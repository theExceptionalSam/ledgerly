const { Router } = require('express');
const { asyncHandler } = require('../middleware/validate');
const ctrl = require('../controllers/platform.controller');

const router = Router();

// All routes require platform admin auth
router.use(ctrl.requirePlatformAdmin);

router.get('/overview', asyncHandler(ctrl.getPlatformOverview));
router.get('/health', asyncHandler(ctrl.getPlatformHealth));

module.exports = router;

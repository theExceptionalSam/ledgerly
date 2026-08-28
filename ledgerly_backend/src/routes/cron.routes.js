const { Router } = require('express');
const { asyncHandler } = require('../middleware/validate');
const ctrl = require('../controllers/cron.controller');

const router = Router();

// All cron routes are protected by CRON_SECRET (checked in-controller). No user auth.
router.use(ctrl.requireCronSecret);

router.post('/cron/weekly-summary', asyncHandler(ctrl.weeklySummary));
router.post('/cron/check-subscriptions', asyncHandler(ctrl.checkSubscriptions));
router.post('/cron/cleanup-tokens', asyncHandler(ctrl.cleanupTokens));

module.exports = router;

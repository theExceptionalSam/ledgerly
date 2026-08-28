const { Router } = require('express');
const { asyncHandler } = require('../middleware/validate');
const ctrl = require('../controllers/cron.controller');

const router = Router();

// All cron routes are protected by CRON_SECRET (checked in-controller). No user auth.
router.use(ctrl.requireCronSecret);

router.post('/weekly-summary', asyncHandler(ctrl.weeklySummary));
router.post('/check-subscriptions', asyncHandler(ctrl.checkSubscriptions));
router.post('/cleanup-tokens', asyncHandler(ctrl.cleanupTokens));
router.post('/process-deletions', asyncHandler(ctrl.processDeletions));

module.exports = router;

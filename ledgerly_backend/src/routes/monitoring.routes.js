const { Router } = require('express');
const { asyncHandler } = require('../middleware/validate');
const ctrl = require('../controllers/monitoring.controller');

const router = Router();
// No auth — this is for external uptime monitors (UptimeRobot, Better Stack).
// Returns only non-sensitive health data (uptime, memory, DB reachability).
router.get('/', asyncHandler(ctrl.getMonitoring));

module.exports = router;

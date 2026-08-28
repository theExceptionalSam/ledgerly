const { Router } = require('express');
const { body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/datarequests.controller');

const router = Router();
router.use(requireAuth);

router.post('/data-requests/export', [
  // exportLimiter would go here, but the existing security.js export limiter is
  // mounted at the route level in server.js if desired. Keep validation empty.
], validate, asyncHandler(ctrl.requestExport));

router.post('/data-requests/deletion', requireRole('owner'), asyncHandler(ctrl.requestDeletion));

router.get('/data-requests', asyncHandler(ctrl.listRequests));

module.exports = router;

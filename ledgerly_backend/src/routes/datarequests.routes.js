const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/datarequests.controller');

const router = Router();
router.use(requireAuth);

router.post('/export', [
  // exportLimiter would go here, but the existing security.js export limiter is
  // mounted at the route level in server.js if desired. Keep validation empty.
], validate, asyncHandler(ctrl.requestExport));

router.post('/deletion', requireRole('owner'), asyncHandler(ctrl.requestDeletion));

router.get('/', asyncHandler(ctrl.listRequests));

// Cancel a pending deletion request (within the 30-day grace period). The
// /:id/cancel route is registered before the /:id/download GET route so the
// 'cancel' string isn't captured as a download id — though since cancel is
// POST and download is GET there's no actual conflict, ordering here is
// purely for clarity.
router.post('/:id/cancel', [param('id').isUUID()], validate, asyncHandler(ctrl.cancelRequest));

router.get('/:id/download', [param('id').isUUID()], validate, asyncHandler(ctrl.downloadExport));

module.exports = router;

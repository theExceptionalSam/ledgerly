const { Router } = require('express');
const { param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/notifications.controller');

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listNotifications));

router.post('/read-all', asyncHandler(ctrl.markAllRead));

router.post('/:id/read', [param('id').isUUID()], validate, asyncHandler(ctrl.markRead));

module.exports = router;

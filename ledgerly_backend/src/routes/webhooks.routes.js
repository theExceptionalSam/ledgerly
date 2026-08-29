const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/webhooks.controller');

const router = Router();
router.use(requireAuth, requireRole('owner'));

router.get('/', asyncHandler(ctrl.listEndpoints));
router.post('/', [
  body('url').isURL({ require_protocol: true, protocols: ['http', 'https'] }),
  body('events').isArray({ min: 1 }),
], validate, asyncHandler(ctrl.createEndpoint));
router.patch('/:id', [
  param('id').isUUID(),
  body('active').optional().isInt({ min: 0, max: 1 }),
  body('events').optional().isArray(),
], validate, asyncHandler(ctrl.updateEndpoint));
router.delete('/:id', [param('id').isUUID()], validate, asyncHandler(ctrl.deleteEndpoint));
router.get('/:id/deliveries', [param('id').isUUID()], validate, asyncHandler(ctrl.listDeliveries));

module.exports = router;

const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/webhooks.controller');

const router = Router();
router.use(requireAuth, requireRole('owner'));

router.get('/webhooks', asyncHandler(ctrl.listEndpoints));
router.post('/webhooks', [
  body('url').isURL({ require_protocol: true, protocols: ['http', 'https'] }),
  body('events').isArray({ min: 1 }),
], validate, asyncHandler(ctrl.createEndpoint));
router.delete('/webhooks/:id', [param('id').isUUID()], validate, asyncHandler(ctrl.deleteEndpoint));

module.exports = router;
